'use strict';

const path = require('path');

const ENGINE_JS = path.join(
  __dirname,
  '..',
  '..',
  'node_modules',
  'stockfish',
  'bin',
  'stockfish-18-lite-single.js'
);
const ENGINE_WASM = path.join(
  __dirname,
  '..',
  '..',
  'node_modules',
  'stockfish',
  'bin',
  'stockfish-18-lite-single.wasm'
);

/**
 * Thin, promise-based wrapper around the Stockfish 18 WASM engine.
 * One instance = one live engine process (in-process WASM). The game
 * manager reuses that instance for the life of a match, then calls quit()
 * when the match finishes.
 */
class AIEngine {
  constructor() {
    this._engine = null;
    this._buffer = [];
    this._waiters = [];
    // ---------------------------------------------------------------
    // Engine Queue: a single UCI engine process only understands one
    // "position ... go ..." conversation at a time. Without this, a
    // hint/eval request landing while an AI move is still being
    // calculated (or vice versa) would interleave commands on the wire
    // and could hand back a best-move for the WRONG position. Every
    // public call (bestMove/evaluate) is funneled through `_enqueue` so
    // they always run strictly one-after-another on this engine
    // instance, regardless of how they were triggered.
    // ---------------------------------------------------------------
    this._queue = Promise.resolve();
  }

  _enqueue(taskFn) {
    const waitForPrevious = this._queue.catch(() => {});
    const run = waitForPrevious.then(taskFn);
    // Keep the queue flowing even if a task throws — only the caller of
    // that specific task should see the rejection.
    this._queue = run.catch(() => {});
    return run;
  }

  async init() {
    const INIT_ENGINE = require(ENGINE_JS);
    const self = this;
    const engine = {
      locateFile(p) {
        return p.indexOf('.wasm') > -1 ? ENGINE_WASM : ENGINE_JS;
      },
      listener(line) {
        self._onLine(line);
      },
    };
    await INIT_ENGINE()(engine);
    engine.sendCommand = function sendCommand(cmd) {
      setImmediate(() => {
        engine.ccall('command', null, ['string'], [cmd], { async: /^go\b/.test(cmd) });
      });
    };
    this._engine = engine;
    await this._send('uci', (line) => line === 'uciok');
    await this._send('isready', (line) => line === 'readyok');
    return this;
  }

  _onLine(line) {
    this._buffer.push(line);
    if (this._onScoreLine) this._onScoreLine(line);
    for (let i = this._waiters.length - 1; i >= 0; i--) {
      const w = this._waiters[i];
      if (w.test(line)) {
        this._waiters.splice(i, 1);
        w.resolve(line);
      }
    }
  }

  _send(cmd, testFn, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const waiter = {
        test: testFn,
        resolve: (line) => {
          clearTimeout(timer);
          resolve(line);
        },
      };
      const timer = setTimeout(() => {
        const idx = this._waiters.indexOf(waiter);
        if (idx !== -1) this._waiters.splice(idx, 1);
        reject(new Error(`Stockfish timed out waiting for response to: ${cmd}`));
      }, timeoutMs);
      this._waiters.push(waiter);
      if (!this._engine) {
        clearTimeout(timer);
        this._waiters = this._waiters.filter((w) => w !== waiter);
        reject(new Error('Stockfish engine is not initialized'));
        return;
      }
      this._engine.sendCommand(cmd);
    });
  }

  setOption(name, value) {
    this._engine.sendCommand(`setoption name ${name} value ${value}`);
  }

  /**
   * @param {string} fen
   * @param {object} opts - { elo?: number, skillLevel?: number, movetimeMs?: number, depth?: number }
   * @returns {Promise<string>} best move in UCI form, e.g. "e2e4" or "e7e8q"
   */
  bestMove(fen, opts = {}) {
    return this._enqueue(() => this._bestMoveImpl(fen, opts));
  }

  async _bestMoveImpl(fen, opts = {}) {
    const { elo, skillLevel, movetimeMs = 700, depth } = opts;
    if (typeof elo === 'number') {
      this.setOption('UCI_LimitStrength', 'true');
      this.setOption('UCI_Elo', Math.max(1320, Math.min(3190, Math.round(elo))));
    } else {
      this.setOption('UCI_LimitStrength', 'false');
    }
    if (typeof skillLevel === 'number') {
      this.setOption('Skill Level', Math.max(0, Math.min(20, Math.round(skillLevel))));
    } else {
      // Stockfish's "Skill Level" persists across calls on the same engine
      // instance — without this, a hint requested in a game against a
      // deliberately weakened AI would silently inherit that weak level.
      this.setOption('Skill Level', 20);
    }
    this._engine.sendCommand(`position fen ${fen}`);
    const goCmd = depth ? `go depth ${depth}` : `go movetime ${movetimeMs}`;
    const line = await this._send(goCmd, (l) => l.startsWith('bestmove'), movetimeMs + 10000);
    const parts = line.split(' ');
    return parts[1]; // bestmove <uci> ponder <uci>
  }

  /** Rough evaluation in centipawns from the side-to-move's perspective (positive = better for them). */
  evaluate(fen, movetimeMs = 300) {
    return this._enqueue(() => this._evaluateImpl(fen, movetimeMs));
  }

  async _evaluateImpl(fen, movetimeMs = 300) {
    this.setOption('UCI_LimitStrength', 'false');
    this.setOption('Skill Level', 20); // evaluation should always be full-strength, regardless of AI difficulty
    this._engine.sendCommand(`position fen ${fen}`);
    let lastScore = 0;
    this._onScoreLine = (l) => {
      const cp = l.match(/score cp (-?\d+)/);
      if (cp) lastScore = parseInt(cp[1], 10);
      const mate = l.match(/score mate (-?\d+)/);
      if (mate) lastScore = parseInt(mate[1], 10) > 0 ? 100000 : -100000;
    };
    try {
      await this._send(`go movetime ${movetimeMs}`, (l) => l.startsWith('bestmove'), movetimeMs + 8000);
      return lastScore;
    } finally {
      this._onScoreLine = null;
    }
  }

  quit() {
    try {
      this._engine && this._engine.sendCommand('quit');
    } catch (e) {
      /* ignore */
    }
    this._engine = null;
    this._onScoreLine = null;
    this._waiters.length = 0;
  }
}

module.exports = AIEngine;
