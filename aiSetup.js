'use strict';

const GameManager = require('../game/GameManager');
const pendingSetups = require('../utils/pendingSetups');
const { getLevel } = require('../game/difficultyLevels');
const {
  buildColorSelect,
  buildGameView,
  buildGameControlsRows,
  simplePayload,
  COLOR_DANGER,
  COLOR_INFO,
} = require('../ui/components');
const { emoji } = require('../utils/emojis');
const { triggerAIMove } = require('../game/turnEngine');

async function handleLevelSelect(interaction, token) {
  const pending = pendingSetups.get(token);
  if (!pending || pending.userId !== interaction.user.id) {
    return interaction.update(
      simplePayload('انتهت صلاحية هذا الإعداد، ابدأ من جديد بـ /chess ai', { accentColor: COLOR_DANGER })
    );
  }
  const levelId = interaction.values[0];
  await interaction.update(
    simplePayload(`المستوى المختار: **${getLevel(levelId).label}** — الآن اختر لونك:`, {
      accentColor: COLOR_INFO,
      rows: [buildColorSelect(token, levelId)],
    })
  );
}

async function handleColorSelect(interaction, token, levelId) {
  const pending = pendingSetups.get(token);
  if (!pending || pending.userId !== interaction.user.id) {
    return interaction.update(
      simplePayload('انتهت صلاحية هذا الإعداد، ابدأ من جديد بـ /chess ai', { accentColor: COLOR_DANGER })
    );
  }
  pendingSetups.remove(token);

  let color = interaction.values[0];
  if (color === 'r') color = Math.random() < 0.5 ? 'w' : 'b';

  const level = getLevel(levelId);
  if (!level) {
    return interaction.update(simplePayload('مستوى غير صالح — ابدأ إعداد مباراة جديدة.', { accentColor: COLOR_DANGER }));
  }
  const human = {
    id: interaction.user.id,
    name: interaction.user.displayName || interaction.user.username,
    username: interaction.user.username,
    avatarURL: interaction.user.displayAvatarURL({ extension: 'png', size: 128 }),
    isAI: false,
  };
  const ai = { id: 'AI', name: `بوت • ${level.label}`, isAI: true, level: level.id };

  const white = color === 'w' ? human : ai;
  const black = color === 'w' ? ai : human;

  const existing = GameManager.findActiveByChannel(interaction.channelId);
  if (existing) {
    return interaction.update(simplePayload('بدأت مباراة أخرى في هذه القناة أثناء الإعداد. أغلق المباراة الحالية ثم ابدأ من جديد.', { accentColor: COLOR_DANGER }));
  }

  const game = GameManager.createGame({ channelId: interaction.channelId, white, black });

  await interaction.update(
    simplePayload(`${emoji('confirm')} بدأت اللعبة! أنت تلعب بـ ${color === 'w' ? 'الأبيض' : 'الأسود'}.`, {
      accentColor: COLOR_INFO,
    })
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

  if (white.isAI) {
    await triggerAIMove(interaction.client, game);
  }
}

module.exports = { handleLevelSelect, handleColorSelect };
