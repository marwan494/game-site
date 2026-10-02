'use strict';

require('dotenv').config();
const { Client, GatewayIntentBits, Events, MessageFlags } = require('discord.js');

const chessCommand = require('./commands/chess');
const moveFlow = require('./interactions/moveFlow');
const gameControls = require('./interactions/gameControls');
const aiSetup = require('./interactions/aiSetup');
const challengeFlow = require('./interactions/challengeFlow');
const inactivityWatcher = require('./game/inactivityWatcher');
const GameManager = require('./game/GameManager');
const { triggerAIMove } = require('./game/turnEngine');
const pendingMoves = require('./utils/pendingMoves');
const { syncApplicationEmojis } = require('./utils/applicationEmojis');
const { simplePayload, COLOR_DANGER } = require('./ui/components');

const { DISCORD_TOKEN } = process.env;
if (!DISCORD_TOKEN) {
  console.error('❌ الرجاء ضبط DISCORD_TOKEN في ملف .env');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

/**
 * Discord component interactions must be acknowledged within a few seconds.
 * Some chess actions wait on the per-game lock, Stockfish, avatar CDN, or
 * Canvas rendering, so the interaction is acknowledged BEFORE entering that
 * slow path. The proxy keeps the existing handlers backwards-compatible:
 *   update() -> editReply() after deferUpdate()
 *   reply()  -> followUp() after deferUpdate()
 *   deferUpdate() -> no-op (already acknowledged)
 *
 * Modal submissions use deferReply() instead, so reply() -> editReply().
 */
function createAcknowledgedInteraction(interaction, { modal = false } = {}) {
  return new Proxy(interaction, {
    get(target, property) {
      if (property === 'update') return target.editReply.bind(target);
      if (property === 'reply') {
        return modal ? target.editReply.bind(target) : target.followUp.bind(target);
      }
      if (property === 'deferUpdate') return async () => {};
      if (property === 'deferReply') return async () => {};
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function deferComponentInteraction(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate();
  }
  return createAcknowledgedInteraction(interaction);
}

async function deferModalInteraction(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
  }
  return createAcknowledgedInteraction(interaction, { modal: true });
}

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ تم تسجيل الدخول باسم ${c.user.tag}`);
  console.log(`♟️  بوت الشطرنج جاهز في ${c.guilds.cache.size} سيرفر.`);
  try {
    await syncApplicationEmojis(c, { createMissing: true });
  } catch (err) {
    console.warn('⚠️ Application emoji sync skipped:', err.message || err);
  }
  GameManager.restorePersistedGames();
  inactivityWatcher.start(c);

  // If a process restart happened while an AI side was supposed to move,
  // resume that turn automatically instead of leaving the restored game stuck.
  const resumed = [...GameManager.games.values()]
    .filter((game) => game.status === 'active' && game[game.chess.turn === 'w' ? 'white' : 'black']?.isAI);
  for (const game of resumed) {
    GameManager.withLock(game.id, () => triggerAIMove(c, game))
      .catch((err) => console.error('Failed to resume AI turn', game.id, err));
  }
});

function withGameLock(gameId, fn) {
  return GameManager.withLock(gameId, fn);
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'chess') return await chessCommand.execute(interaction);
      return;
    }

    if (interaction.isStringSelectMenu()) {
      const [ns, action, ...rest] = interaction.customId.split(':');
      const acknowledged = await deferComponentInteraction(interaction);

      if (ns === 'mv' && action === 'from') {
        return await withGameLock(rest[0], () => moveFlow.handleFromSelect(acknowledged, rest[0]));
      }
      if (ns === 'mv' && action === 'to') {
        return await withGameLock(rest[0], () => moveFlow.handleToSelect(acknowledged, rest[0], rest[1]));
      }
      if (ns === 'mv' && action === 'promo') {
        return await withGameLock(rest[0], () => moveFlow.handlePromoSelect(acknowledged, rest[0], rest[1], rest[2]));
      }
      if (ns === 'ai' && action === 'level') return await aiSetup.handleLevelSelect(acknowledged, rest[0]);
      if (ns === 'ai' && action === 'color') return await aiSetup.handleColorSelect(acknowledged, rest[0], rest[1]);
      return;
    }

    if (interaction.isButton()) {
      const parts = interaction.customId.split(':');
      const [ns, action] = parts;

      // A modal must be shown as the FIRST response; it cannot be preceded by
      // deferUpdate. This handler only performs cheap validation before showModal.
      if (ns === 'mv' && action === 'type') {
        return await moveFlow.handleMoveTypeModalOpen(interaction, parts[2]);
      }

      const acknowledged = await deferComponentInteraction(interaction);

      if (ns === 'chg' && action === 'acc') return await challengeFlow.handleAccept(acknowledged, parts[2]);
      if (ns === 'chg' && action === 'dec') return await challengeFlow.handleDecline(acknowledged, parts[2]);

      if (ns === 'mv' && action === 'open') return await withGameLock(parts[2], () => moveFlow.handleMoveOpen(acknowledged, parts[2]));
      if (ns === 'mv' && action === 'confirm') {
        const pending = pendingMoves.get(parts[2]);
        return await withGameLock(pending ? pending.gameId : null, () => moveFlow.handleMoveConfirm(acknowledged, parts[2]));
      }
      if (ns === 'mv' && action === 'cancel') {
        const pending = pendingMoves.get(parts[2]);
        return await withGameLock(pending ? pending.gameId : null, () => moveFlow.handleMoveCancel(acknowledged, parts[2]));
      }

      if (ns === 'game' && action === 'history') return await gameControls.handleHistory(acknowledged, parts[2]);
      if (ns === 'game' && action === 'hint') return await withGameLock(parts[2], () => gameControls.handleHint(acknowledged, parts[2]));
      if (ns === 'game' && action === 'rematch') return await withGameLock(parts[2], () => gameControls.handleRematch(acknowledged, parts[2]));

      if (ns === 'game' && action === 'takeback' && parts.length === 3) {
        return await withGameLock(parts[2], () => gameControls.handleTakebackRequest(acknowledged, parts[2]));
      }
      if (ns === 'game' && action === 'takeback' && parts[2] === 'acc') {
        return await withGameLock(parts[3], () => gameControls.handleTakebackAccept(acknowledged, parts[3]));
      }
      if (ns === 'game' && action === 'takeback' && parts[2] === 'dec') {
        return await withGameLock(parts[3], () => gameControls.handleTakebackDecline(acknowledged, parts[3]));
      }

      if (ns === 'game' && action === 'resign' && parts.length === 3) {
        return await withGameLock(parts[2], () => gameControls.handleResignButton(acknowledged, parts[2]));
      }
      if (ns === 'game' && action === 'resign' && parts[2] === 'confirm') {
        return await withGameLock(parts[3], () => gameControls.handleResignConfirm(acknowledged, parts[3]));
      }
      if (ns === 'game' && action === 'resign' && parts[2] === 'cancel') {
        return await withGameLock(parts[3], () => gameControls.handleResignCancel(acknowledged, parts[3]));
      }
      if (ns === 'game' && action === 'draw' && parts.length === 3) {
        return await withGameLock(parts[2], () => gameControls.handleDrawOffer(acknowledged, parts[2]));
      }
      if (ns === 'game' && action === 'draw' && parts[2] === 'acc') {
        return await withGameLock(parts[3], () => gameControls.handleDrawAccept(acknowledged, parts[3]));
      }
      if (ns === 'game' && action === 'draw' && parts[2] === 'dec') {
        return await withGameLock(parts[3], () => gameControls.handleDrawDecline(acknowledged, parts[3]));
      }
      if (ns === 'game' && action === 'flip') return await withGameLock(parts[2], () => gameControls.handleFlip(acknowledged, parts[2]));
      return;
    }

    if (interaction.isModalSubmit()) {
      const [ns, action, gameId] = interaction.customId.split(':');
      if (ns === 'mv' && action === 'sanmodal') {
        const acknowledged = await deferModalInteraction(interaction);
        return await withGameLock(gameId, () => moveFlow.handleSanModalSubmit(acknowledged, gameId));
      }
      return;
    }
  } catch (err) {
    console.error('خطأ في معالجة التفاعل:', err);
    const payload = simplePayload('حدث خطأ غير متوقع، حاول مرة أخرى.', { accentColor: COLOR_DANGER, ephemeral: true });
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload);
      } else {
        await interaction.reply(payload);
      }
    } catch (_) {
      // The interaction may have expired or already been acknowledged.
    }
  }
});

client.on(Events.Error, (err) => {
  console.error('Discord client error:', err);
});

client.login(DISCORD_TOKEN).catch((err) => {
  console.error('❌ Discord login failed:', err);
  process.exit(1);
});
