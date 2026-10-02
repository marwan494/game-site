'use strict';

const GameManager = require('./GameManager');
const { getLevel } = require('./difficultyLevels');
const store = require('../utils/store');
const { buildGameView, buildGameControlsRows, buildPostGameRow } = require('../ui/components');
const { emoji } = require('../utils/emojis');

async function fetchMessage(client, game) {
  const channel = await client.channels.fetch(game.channelId);
  return channel.messages.fetch(game.messageId);
}

async function refreshBoardMessage(client, game, opts = {}) {
  const message = await fetchMessage(client, game);
  const over = game.chess.isGameOver() || game.status === 'finished';
  const rows = over
    ? buildPostGameRow(game.id)
    : buildGameControlsRows(game.id, { canDraw: !bothAreAI(game), canTakeback: !bothAreAI(game) });
  const view = await buildGameView(game, { ...opts, rows });
  await message.edit(view);
  return message;
}

function bothAreAI(game) {
  return game.white.isAI && game.black.isAI;
}

/** Call after ANY move (human or AI) has been applied to game.chess. */
async function afterMoveApplied(client, game) {
  game.drawOfferBy = null;
  game.takebackOfferBy = null;
  GameManager.touch(game.id);

  if (game.chess.isGameOver()) {
    return finalizeGameByRules(client, game);
  }

  await refreshBoardMessage(client, game);

  const sideToMove = game.chess.turn;
  const playerToMove = sideToMove === 'w' ? game.white : game.black;
  if (playerToMove.isAI) {
    await triggerAIMove(client, game);
  }
}

async function triggerAIMove(client, game) {
  if (!game || game.status !== 'active') return;
  const side = game.chess.turn === 'w' ? game.white : game.black;
  if (!side.isAI) return;

  const level = getLevel(side.level);
  if (!level) {
    console.error('AI level missing for game', game.id, side.level, '— using safe legal fallback.');
  }

  let applied = false;
  try {
    let uci;
    if (!level) {
      const moves = game.chess.chess.moves({ verbose: true });
      if (!moves.length) return finalizeGameByRules(client, game);
      const pick = moves[0];
      uci = pick.from + pick.to + (pick.promotion || '');
    } else {
      const engine = await GameManager.ensureEngine(game);
      const useRandom = level.randomness > 0 && Math.random() < level.randomness;
      if (useRandom) {
        const moves = game.chess.chess.moves({ verbose: true });
        if (!moves.length) return finalizeGameByRules(client, game);
        const pick = moves[Math.floor(Math.random() * moves.length)];
        uci = pick.from + pick.to + (pick.promotion || '');
      } else {
        uci = await engine.bestMove(game.chess.fen(), level.engine);
      }
    }
    const result = game.chess.moveUci(uci);
    if (!result.ok) throw new Error(`Stockfish returned illegal move: ${uci}`);
    game.lastMove = { from: result.move.from, to: result.move.to };
    applied = true;
  } catch (e) {
    console.error('AI move failed — using legal fallback:', e);
    try {
      const moves = game.chess.chess.moves({ verbose: true });
      if (!moves.length) return finalizeGameByRules(client, game);
      // Deterministic legal fallback keeps the match alive without recursively
      // calling triggerAIMove on the same failed state.
      const pick = moves[0];
      const fallback = game.chess.move({ from: pick.from, to: pick.to, promotion: pick.promotion });
      if (fallback.ok) {
        game.lastMove = { from: fallback.move.from, to: fallback.move.to };
        applied = true;
      }
    } catch (fallbackErr) {
      console.error('AI fallback failed:', fallbackErr);
    }
  }

  if (!applied) {
    await finalizeGame(client, game, side === game.white ? 'b' : 'w', `${emoji('resign')} تعذر على المحرك إكمال النقلة بأمان.`);
    return;
  }
  await afterMoveApplied(client, game);
}

async function finalizeGameByRules(client, game) {
  let resultSide = null; // 'w' | 'b' | 'draw'
  if (game.chess.isCheckmate()) {
    resultSide = game.chess.turn === 'w' ? 'b' : 'w'; // side NOT to move just delivered mate
  } else {
    resultSide = 'draw';
  }
  await finalizeGame(client, game, resultSide);
}

async function finalizeGame(client, game, resultSide, note) {
  await GameManager.finish(game.id);

  const isHumanPvp = !game.white.isAI && !game.black.isAI;
  if (isHumanPvp) {
    const result = resultSide === 'draw' ? 'draw' : resultSide === 'w' ? 'white' : 'black';
    store.saveResult(game.white.id, game.white.name, game.black.id, game.black.name, result);
  }

  const icon = resultSide === 'draw' ? emoji('draw') : emoji('checkmate');
  const finalNote = note || `${icon} ${game.chess.outcomeText() || 'تعادل'}`;

  await refreshBoardMessage(client, game, { note: finalNote });
}

module.exports = {
  refreshBoardMessage,
  afterMoveApplied,
  triggerAIMove,
  finalizeGame,
  bothAreAI,
};
