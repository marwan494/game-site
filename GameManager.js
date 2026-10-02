'use strict';

const crypto = require('crypto');
const ChessGame = require('./ChessGame');
const AIEngine = require('./AIEngine');
const gameStore = require('../utils/gameStore');

function newId() {
  return crypto.randomBytes(4).toString('hex');
}

/**
 * Registry for live/just-finished games. State is memory-backed for fast
 * interaction, with an atomic disk snapshot for restart recovery. A broken
 * persistence file is isolated so it can never block the bot from starting.
 */
class GameManager {
  constructor() {
    /** @type {Map<string, object>} */
    this.games = new Map();
    /**
     * Per-game execution queue ("Game Lock"). Value = a promise chain
     * representing every operation queued so far for that game.
     * Every interaction that can read-then-mutate a game's state goes
     * through `withLock`, so two interactions on the same game (e.g. a
     * takeback request arriving while the AI is still "thinking" on its
     * move, or an inactivity auto-resign firing at the same moment a
     * human clicks resign) can never interleave — the second one simply
     * waits for the first to fully finish before it starts.
     * @type {Map<string, Promise<any>>}
     */
    this._locks = new Map();
  }

  _snapshot(game) {
    return {
      id: game.id,
      channelId: game.channelId,
      messageId: game.messageId,
      white: game.white,
      black: game.black,
      flipped: !!game.flipped,
      lastMove: game.lastMove,
      drawOfferBy: game.drawOfferBy,
      takebackOfferBy: game.takebackOfferBy,
      status: game.status,
      createdAt: game.createdAt,
      lastActivity: game.lastActivity,
      inactivityWarned: !!game.inactivityWarned,
      expiresAt: game.expiresAt || null,
      history: game.chess.history(),
    };
  }

  persist(id) {
    const game = this.games.get(id);
    if (!game) return;
    try {
      gameStore.upsert(this._snapshot(game));
    } catch (err) {
      console.error('Could not persist chess game', id, err.message || err);
    }
  }

  restorePersistedGames() {
    const now = Date.now();
    let restored = 0;
    for (const snapshot of gameStore.load()) {
      if (!snapshot || !snapshot.id) continue;
      if (snapshot.expiresAt && snapshot.expiresAt <= now) {
        gameStore.remove(snapshot.id);
        continue;
      }
      if (snapshot.status !== 'finished' && !snapshot.messageId) {
        console.warn(`🧹 Removing orphaned persisted game ${snapshot.id} (no board message).`);
        gameStore.remove(snapshot.id);
        continue;
      }
      try {
        const chess = new ChessGame();
        chess.loadHistory(Array.isArray(snapshot.history) ? snapshot.history : []);
        const game = {
          id: snapshot.id,
          channelId: snapshot.channelId,
          messageId: snapshot.messageId || null,
          white: snapshot.white,
          black: snapshot.black,
          chess,
          flipped: !!snapshot.flipped,
          lastMove: snapshot.lastMove || null,
          drawOfferBy: snapshot.drawOfferBy || null,
          takebackOfferBy: snapshot.takebackOfferBy || null,
          status: snapshot.status || 'active',
          aiEngine: null,
          createdAt: snapshot.createdAt || now,
          lastActivity: snapshot.lastActivity || now,
          inactivityWarned: !!snapshot.inactivityWarned,
          expiresAt: snapshot.expiresAt || null,
        };
        this.games.set(game.id, game);
        if (game.status === 'finished') {
        game.expiresAt = game.expiresAt || now + 10 * 60 * 1000;
        this._scheduleCleanup(game);
      }
        restored += 1;
      } catch (err) {
        console.error('Could not restore persisted chess game', snapshot.id, err.message || err);
        gameStore.remove(snapshot.id);
      }
    }
    console.log(`♟️ Restored ${restored} persisted chess game(s).`);
    return restored;
  }

  _scheduleCleanup(game) {
    const delay = Math.max(0, (game.expiresAt || (Date.now() + 10 * 60 * 1000)) - Date.now());
    setTimeout(() => {
      this.games.delete(game.id);
      this._locks.delete(game.id);
      gameStore.remove(game.id);
    }, delay).unref();
  }

  createGame({ channelId, white, black, flipped = false }) {
    const id = newId();
    const game = {
      id,
      channelId,
      messageId: null,
      white, // { id, name, isAI, level? }
      black, // { id, name, isAI, level? }
      chess: new ChessGame(),
      flipped,
      lastMove: null,
      drawOfferBy: null,
      takebackOfferBy: null,
      status: 'active',
      aiEngine: null,
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };
    this.games.set(id, game);
    this.persist(id);
    return game;
  }

  get(id) {
    return this.games.get(id);
  }

  abort(id) {
    const game = this.games.get(id);
    if (!game) return;
    try {
      game.aiEngine?.quit();
    } catch (_) {
      /* best-effort cleanup */
    }
    this.games.delete(id);
    this._locks.delete(id);
    try { gameStore.remove(id); } catch (err) { console.error('Could not remove aborted chess game', id, err.message || err); }
  }

  findActiveByChannel(channelId) {
    for (const g of this.games.values()) {
      if (g.channelId === channelId && g.status === 'active') return g;
    }
    return null;
  }

  touch(id) {
    const g = this.games.get(id);
    if (g) {
      g.lastActivity = Date.now();
      this.persist(id);
    }
  }

  /**
   * Runs `fn` exclusively for `gameId`: if another locked operation for
   * the same game is still in flight (including all of its `await`s —
   * e.g. waiting on the Stockfish engine), this call queues behind it
   * and only starts once that one has fully settled. This is the single
   * choke point that keeps the board, turn order, and pending offers
   * consistent no matter how fast or oddly-timed the incoming Discord
   * interactions are.
   *
   * Errors thrown by `fn` propagate normally to the caller of
   * `withLock` — they do NOT break the queue for the next task.
   *
   * @template T
   * @param {string|null|undefined} gameId
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  withLock(gameId, fn) {
    if (!gameId) return Promise.resolve().then(fn);
    const previousTail = this._locks.get(gameId) || Promise.resolve();
    // Wait for whatever came before us, regardless of whether it
    // succeeded or failed — a failed action must not jam the queue.
    const myTurn = previousTail.catch(() => {});
    const result = myTurn.then(fn);
    // The new tail also swallows its own rejection for queueing
    // purposes only; the real result/error still flows to our caller
    // via `result`, returned below.
    this._locks.set(gameId, result.catch(() => {}));
    return result;
  }

  async ensureEngine(game) {
    if (!game.aiEngine) {
      game.aiEngine = new AIEngine();
      await game.aiEngine.init();
    }
    return game.aiEngine;
  }

  async finish(id) {
    const game = this.games.get(id);
    if (!game) return;
    game.status = 'finished';
    game.expiresAt = Date.now() + 10 * 60 * 1000;
    if (game.aiEngine) {
      game.aiEngine.quit();
      game.aiEngine = null;
    }
    // Keep the final game state for rematch/recovery for a short window.
    this.persist(id);
    this._scheduleCleanup(game);
  }

  /** Side ('w'|'b') that a given Discord user is playing, or null. */
  sideOf(game, userId) {
    if (game.white.id === userId && !game.white.isAI) return 'w';
    if (game.black.id === userId && !game.black.isAI) return 'b';
    return null;
  }

  playerFor(game, side) {
    return side === 'w' ? game.white : game.black;
  }
}

module.exports = new GameManager();
