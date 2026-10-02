'use strict';

const GameManager = require('./GameManager');
const { finalizeGame } = require('./turnEngine');
const { simplePayload, COLOR_INFO } = require('../ui/components');
const { emoji } = require('../utils/emojis');

const CHECK_INTERVAL_MS = 15 * 60 * 1000; // scan every 15 minutes
const WARNING_AFTER_MS = 48 * 60 * 60 * 1000; // ping a reminder after 48h of silence
const TIMEOUT_AFTER_MS = 72 * 60 * 60 * 1000; // auto-resign after 72h of silence

/**
 * A game only "ticks" on real moves (GameManager.touch is called from
 * afterMoveApplied), so lastActivity is genuinely "time since someone
 * last moved" — exactly what we want to measure here. Games are persisted to disk, so the inactivity clock survives process
 * restarts as well.
 */
function start(client) {
  setInterval(() => sweep(client), CHECK_INTERVAL_MS).unref();
}

async function sweep(client) {
  const now = Date.now();
  for (const game of GameManager.games.values()) {
    if (game.status !== 'active') continue;
    if (game.white.isAI && game.black.isAI) continue; // shouldn't happen, but be safe
    const idleFor = now - game.lastActivity;

    try {
      if (idleFor >= TIMEOUT_AFTER_MS) {
        // Routed through the same per-game lock as every interactive
        // handler ("Game Lock") — without it, this background sweep
        // could fire an auto-resign at the exact moment a human clicks
        // resign/draw/move themselves, finalizing the same game twice.
        await GameManager.withLock(game.id, () => autoResignForInactivity(client, game));
      } else if (idleFor >= WARNING_AFTER_MS && !game.inactivityWarned) {
        game.inactivityWarned = true;
        await sendInactivityWarning(client, game);
      }
    } catch (e) {
      console.error('Inactivity sweep failed for game', game.id, e);
    }
  }
}

async function autoResignForInactivity(client, game) {
  if (game.status !== 'active') return; // finalized by something else while we waited for the lock
  const toMove = game.chess.turn === 'w' ? game.white : game.black;
  const winner = game.chess.turn === 'w' ? 'b' : 'w';
  // Only meaningful if the side that stalled is human — an AI never idles.
  if (toMove.isAI) return;
  await finalizeGame(client, game, winner, `${emoji('resign')} ${toMove.name} لم يتحرك لمدة 72 ساعة — استسلام تلقائي.`);
}

async function sendInactivityWarning(client, game) {
  const toMove = game.chess.turn === 'w' ? game.white : game.black;
  if (toMove.isAI) return;
  try {
    const channel = await client.channels.fetch(game.channelId);
    await channel.send(
      simplePayload(
        `<@${toMove.id}> ذكّر لطيف: لم تتحرك منذ فترة في مباراة الشطرنج. ستُعتبر مستسلمًا تلقائيًا إذا لم تلعب خلال 24 ساعة القادمة.`,
        { accentColor: COLOR_INFO }
      )
    );
  } catch (e) {
    // Channel may have been deleted, or the bot may lack permissions — not fatal.
    console.error('Could not send inactivity warning for game', game.id, e);
  }
}

module.exports = { start };
