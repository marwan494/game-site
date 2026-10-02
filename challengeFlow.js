'use strict';

const GameManager = require('../game/GameManager');
const pendingSetups = require('../utils/pendingSetups');
const { buildGameView, buildGameControlsRows, simplePayload, COLOR_DANGER, COLOR_SUCCESS } = require('../ui/components');
const { emoji } = require('../utils/emojis');

async function handleAccept(interaction, token) {
  const pending = pendingSetups.get(token);
  if (!pending) {
    return interaction.update(simplePayload('انتهت صلاحية هذا التحدي.', { accentColor: COLOR_DANGER }));
  }
  if (interaction.user.id !== pending.challengedId) {
    return interaction.reply(simplePayload('هذا التحدي ليس لك.', { accentColor: COLOR_DANGER, ephemeral: true }));
  }
  pendingSetups.remove(token);

  // Randomize colors for fairness.
  const challenger = {
    id: pending.challengerId,
    name: pending.challengerName,
    username: pending.challengerUsername,
    avatarURL: pending.challengerAvatarURL,
    isAI: false,
  };
  const challenged = {
    id: pending.challengedId,
    name: pending.challengedName,
    username: pending.challengedUsername,
    avatarURL: pending.challengedAvatarURL,
    isAI: false,
  };
  const challengerIsWhite = Math.random() < 0.5;
  const white = challengerIsWhite ? challenger : challenged;
  const black = challengerIsWhite ? challenged : challenger;

  const existing = GameManager.findActiveByChannel(interaction.channelId);
  if (existing) {
    return interaction.update(simplePayload('هناك مباراة نشطة بالفعل في هذه القناة.', { accentColor: COLOR_DANGER }));
  }

  const game = GameManager.createGame({ channelId: interaction.channelId, white, black });

  await interaction.update(
    simplePayload(`${emoji('confirm')} تم قبول التحدي! بدأت اللعبة أدناه.`, { accentColor: COLOR_SUCCESS })
  );

  const view = await buildGameView(game, { rows: buildGameControlsRows(game.id) });
  let message;
  try {
    message = await interaction.channel.send(view);
  } catch (err) {
    GameManager.abort(game.id);
    console.error('Could not create chess board message:', err);
    return interaction.followUp(
      simplePayload('تعذر نشر لوحة المباراة. تم إلغاء المباراة بأمان، حاول مرة أخرى.', { accentColor: COLOR_DANGER, ephemeral: true })
    ).catch(() => {});
  }
  game.messageId = message.id;
  GameManager.persist(game.id);
}

async function handleDecline(interaction, token) {
  const pending = pendingSetups.get(token);
  if (!pending) {
    return interaction.update(simplePayload('انتهت صلاحية هذا التحدي.', { accentColor: COLOR_DANGER }));
  }
  if (interaction.user.id !== pending.challengedId) {
    return interaction.reply(simplePayload('هذا التحدي ليس لك.', { accentColor: COLOR_DANGER, ephemeral: true }));
  }
  pendingSetups.remove(token);
  await interaction.update(simplePayload(`${emoji('cancel')} تم رفض التحدي.`, { accentColor: COLOR_DANGER }));
}

module.exports = { handleAccept, handleDecline };
