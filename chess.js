'use strict';

const { SlashCommandBuilder } = require('discord.js');
const GameManager = require('../game/GameManager');
const pendingSetups = require('../utils/pendingSetups');
const store = require('../utils/store');
const { LEVELS } = require('../game/difficultyLevels');
const {
  buildChallengeView,
  buildAILevelSelect,
  buildGameView,
  buildGameControlsRows,
  simplePayload,
  COLOR_INFO,
  COLOR_DANGER,
} = require('../ui/components');
const { emoji } = require('../utils/emojis');

const CREDIT_LINE_HELP = `-# __**Powered By TC Team — 7amo**__`;

const data = new SlashCommandBuilder()
  .setName('chess')
  .setDescription('لعب الشطرنج — بين شخصين أو ضد بوت ذكي')
  .addSubcommand((sub) =>
    sub
      .setName('pvp')
      .setDescription('تحدَّ شخصًا آخر في مباراة شطرنج')
      .addUserOption((opt) => opt.setName('الخصم').setDescription('الشخص الذي تريد تحديه').setRequired(true))
  )
  .addSubcommand((sub) => sub.setName('ai').setDescription('العب ضد بوت شطرنج ذكي (اختر المستوى)'))
  .addSubcommand((sub) => sub.setName('board').setDescription('أظهر لوحة اللعبة الحالية في هذه القناة'))
  .addSubcommand((sub) =>
    sub
      .setName('stats')
      .setDescription('عرض إحصائياتك أو إحصائيات شخص آخر')
      .addUserOption((opt) => opt.setName('اللاعب').setDescription('اترك فارغًا لعرض إحصائياتك').setRequired(false))
  )
  .addSubcommand((sub) => sub.setName('leaderboard').setDescription('لوحة المتصدرين'))
  .addSubcommand((sub) => sub.setName('help').setDescription('شرح كيفية اللعب'));

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'pvp') return handlePvp(interaction);
  if (sub === 'ai') return handleAi(interaction);
  if (sub === 'board') return handleBoard(interaction);
  if (sub === 'stats') return handleStats(interaction);
  if (sub === 'leaderboard') return handleLeaderboard(interaction);
  if (sub === 'help') return handleHelp(interaction);
}

async function handlePvp(interaction) {
  const opponent = interaction.options.getUser('الخصم');
  if (opponent.bot) {
    return interaction.reply(
      simplePayload('لا يمكنك تحدي بوت — استخدم `/chess ai` بدلًا من ذلك.', { accentColor: COLOR_DANGER, ephemeral: true })
    );
  }
  if (opponent.id === interaction.user.id) {
    return interaction.reply(simplePayload('لا يمكنك تحدي نفسك.', { accentColor: COLOR_DANGER, ephemeral: true }));
  }

  const existing = GameManager.findActiveByChannel(interaction.channelId);
  if (existing) {
    return interaction.reply(
      simplePayload('يوجد بالفعل لعبة نشطة في هذه القناة.', { accentColor: COLOR_DANGER, ephemeral: true })
    );
  }

  const token = pendingSetups.create({
    challengerId: interaction.user.id,
    challengerName: interaction.user.displayName || interaction.user.username,
    challengerUsername: interaction.user.username,
    challengerAvatarURL: interaction.user.displayAvatarURL({ extension: 'png', size: 128 }),
    challengedId: opponent.id,
    challengedName: opponent.displayName || opponent.username,
    challengedUsername: opponent.username,
    challengedAvatarURL: opponent.displayAvatarURL({ extension: 'png', size: 128 }),
  });

  await interaction.reply(buildChallengeView(interaction.user.id, opponent.id, token));
}

async function handleAi(interaction) {
  const existing = GameManager.findActiveByChannel(interaction.channelId);
  if (existing) {
    return interaction.reply(
      simplePayload('يوجد بالفعل لعبة نشطة في هذه القناة.', { accentColor: COLOR_DANGER, ephemeral: true })
    );
  }
  const token = pendingSetups.create({ userId: interaction.user.id });
  await interaction.reply(
    simplePayload('اختر مستوى صعوبة البوت — من مبتدئ إلى محرك بكامل قوته:', {
      accentColor: COLOR_INFO,
      ephemeral: true,
      rows: [buildAILevelSelect(token)],
    })
  );
}

async function handleBoard(interaction) {
  const game = GameManager.findActiveByChannel(interaction.channelId);
  if (!game) {
    return interaction.reply(
      simplePayload('لا توجد لعبة نشطة في هذه القناة حاليًا.', { accentColor: COLOR_DANGER, ephemeral: true })
    );
  }
  // Canvas rendering + Discord avatar loading can exceed the interaction
  // response window. Acknowledge first, then render and edit the reply.
  await interaction.deferReply();
  const view = await buildGameView(game, { rows: buildGameControlsRows(game.id) });
  await interaction.editReply(view);
  const message = await interaction.fetchReply();
  // Guarded by the same per-game lock as every other game-mutating
  // interaction, so this can't race with e.g. an AI move mid-flight
  // reassigning/using `messageId` at the same time.
  await GameManager.withLock(game.id, async () => {
    game.messageId = message.id;
  GameManager.persist(game.id);
    game.channelId = interaction.channelId;
  });
}

async function handleStats(interaction) {
  const user = interaction.options.getUser('اللاعب') || interaction.user;
  const p = store.getPlayer(user.id, user.displayName || user.username);
  const total = p.wins + p.losses + p.draws;
  const winRate = total > 0 ? Math.round((p.wins / total) * 100) : 0;
  const text = [
    `### ${emoji('trophy')} إحصائيات ${p.name}`,
    `**عدد المباريات:** ${p.gamesPlayed}`,
    `**فوز / خسارة / تعادل:** ${p.wins} / ${p.losses} / ${p.draws}`,
    `**نسبة الفوز:** ${winRate}%`,
  ].join('\n');
  await interaction.reply(simplePayload(text, { accentColor: COLOR_INFO }));
}

async function handleLeaderboard(interaction) {
  const top = store.leaderboard(10);
  if (!top.length) {
    return interaction.reply(
      simplePayload('لا توجد نتائج بعد — العبوا بعض المباريات أولًا!', { accentColor: COLOR_INFO, ephemeral: true })
    );
  }
  const lines = top.map((p, i) => `**${i + 1}.** ${p.name} — \`${p.wins}\` فوز (${p.wins}ف/${p.losses}خ/${p.draws}ت)`);
  const text = [`### ${emoji('trophy')} لوحة المتصدرين`, ...lines].join('\n');
  await interaction.reply(simplePayload(text, { accentColor: COLOR_INFO }));
}

async function handleHelp(interaction) {
  const levelsText = LEVELS.map((l) => `${l.label} — ELO ${l.elo}`).join('\n');
  const text = [
    `### ${emoji('capture')} كيف تلعب`,
    '**`/chess pvp @شخص`** — تحدَّ لاعبًا آخر (الألوان عشوائية).',
    '**`/chess ai`** — العب ضد البوت، اختر المستوى ثم لونك.',
    '**`/chess board`** — أظهر اللوحة الحالية من جديد.',
    '**`/chess stats`** و **`/chess leaderboard`** — تتبّع سجل انتصاراتك.',
    '',
    '**أثناء اللعب:**',
    `${emoji('move')} **نقلة** — اختر القطعة ثم الوجهة من قوائم منسدلة (سهل وموجّه).`,
    '**اكتب نقلة** — لمن يفضل الكتابة المباشرة (مثل e4 أو Nf3).',
    `${emoji('draw')} **عرض تعادل** • ${emoji('resign')} **استسلام** • ${emoji('flip')} **قلب اللوحة**`,
    `${emoji('history')} **السجل** • ${emoji('takeback')} **طلب تراجع**`,
    '',
    `**مستويات البوت (تقييم ELO يخص البوتات فقط):**\n${levelsText}`,
    '',
    CREDIT_LINE_HELP,
  ].join('\n');
  await interaction.reply(simplePayload(text, { accentColor: COLOR_INFO, ephemeral: true }));
}

module.exports = { data, execute };
