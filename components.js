'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder,
  ContainerBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} = require('discord.js');
const { renderGameImage } = require('../render/boardRenderer');
const { LEVELS, getLevel } = require('../game/difficultyLevels');
const { emoji, emojiObj } = require('../utils/emojis');

const PIECE_NAME = { p: 'بيدق', n: 'حصان', b: 'فيل', r: 'قلعة', q: 'ملكة', k: 'ملك' };

const COLOR_ACTIVE = 0xD7D7D0;
const COLOR_ENDED = 0x7E7E80;
const COLOR_INFO = 0xB4B4B8;
const COLOR_DANGER = 0xA94A4A;
const COLOR_SUCCESS = 0xD9D9D2;

const CREDIT_LINE = `-# __**Powered By TC Team — 7amo**__`;
const V2 = MessageFlags.IsComponentsV2;
const V2_EPHEMERAL = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

function withEmoji(builder, name) {
  const e = emojiObj(name);
  if (e) builder.setEmoji(e);
  return builder;
}

function squareLabel(square, piece) {
  return `${square} — ${PIECE_NAME[piece.type]}`;
}

/**
 * Auto-dismiss a transient ephemeral reply (e.g. "✅ تم لعب النقلة") a
 * short moment after it's shown, instead of leaving it sitting there
 * needing a manual "Dismiss message" tap. Only ever call this on
 * ephemeral, *terminal* replies — never on a menu the user still needs
 * to interact with, and never on the public board/offer messages (those
 * aren't ephemeral and have no dismiss button anyway).
 */
function scheduleAutoDismiss(interaction, ms = 1400) {
  setTimeout(() => {
    interaction.deleteReply().catch(() => {});
  }, ms).unref();
}

// ---------------------------------------------------------------------------
// Generic small container — used for every plain notice / confirmation
// instead of a bare `{ content }` reply, so the whole bot speaks one
// consistent Components V2 visual language, not just the board messages.
// ---------------------------------------------------------------------------
function simplePayload(text, { accentColor = COLOR_INFO, ephemeral = false, rows = [] } = {}) {
  const container = new ContainerBuilder()
    .setAccentColor(accentColor)
    .addTextDisplayComponents((td) => td.setContent(text));
  for (const row of rows) container.addActionRowComponents(row);
  return { flags: ephemeral ? V2_EPHEMERAL : V2, components: [container] };
}

// ---------------------------------------------------------------------------
// Generic image+text container — backs the board view, move previews,
// promotion prompts, and piece-selection previews.
// ---------------------------------------------------------------------------
function buildImageContainerPayload({
  accentColor = COLOR_INFO,
  text,
  footer,
  imageBuffer,
  imageName = 'board.png',
  rows = [],
  ephemeral = false,
}) {
  const attachment = new AttachmentBuilder(imageBuffer, { name: imageName });
  const container = new ContainerBuilder()
    .setAccentColor(accentColor)
    .addTextDisplayComponents((td) => td.setContent(text))
    .addMediaGalleryComponents((g) => g.addItems((i) => i.setURL(`attachment://${imageName}`)));
  for (const row of rows) container.addActionRowComponents(row);
  if (footer) {
    container
      .addSeparatorComponents((s) => s.setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents((td) => td.setContent(footer));
  }
  return {
    flags: ephemeral ? V2_EPHEMERAL : V2,
    components: [container],
    files: [attachment],
  };
}

// ---------------------------------------------------------------------------
// Challenge (PvP invite)
// ---------------------------------------------------------------------------
function buildChallengeView(challengerId, opponentId, token) {
  const row = new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder().setCustomId(`chg:acc:${token}`).setLabel('قبول التحدي').setStyle(ButtonStyle.Success), 'confirm'),
    withEmoji(new ButtonBuilder().setCustomId(`chg:dec:${token}`).setLabel('رفض').setStyle(ButtonStyle.Danger), 'cancel')
  );
  const text = [
    `## ${emoji('challenge')} تحدي شطرنج جديد`,
    `<@${challengerId}> يتحدى <@${opponentId}> لمباراة شطرنج!`,
    'الألوان ستُحدد عشوائيًا.',
  ].join('\n');
  const container = new ContainerBuilder()
    .setAccentColor(COLOR_INFO)
    .addTextDisplayComponents((td) => td.setContent(text))
    .addActionRowComponents(row);
  return { flags: V2, components: [container] };
}

// ---------------------------------------------------------------------------
// Active-game control rows (appended inside the main board container)
// ---------------------------------------------------------------------------
function buildGameControlsRows(gameId, { canDraw = true, canTakeback = true } = {}) {
  const row1 = new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder().setCustomId(`mv:open:${gameId}`).setLabel('نقلة').setStyle(ButtonStyle.Primary), 'move'),
    new ButtonBuilder().setCustomId(`mv:type:${gameId}`).setLabel('اكتب نقلة').setStyle(ButtonStyle.Secondary)
  );
  if (canDraw) {
    row1.addComponents(
      withEmoji(new ButtonBuilder().setCustomId(`game:draw:${gameId}`).setLabel('عرض تعادل').setStyle(ButtonStyle.Secondary), 'draw')
    );
  }
  row1.addComponents(
    withEmoji(new ButtonBuilder().setCustomId(`game:resign:${gameId}`).setLabel('استسلام').setStyle(ButtonStyle.Danger), 'resign'),
    withEmoji(new ButtonBuilder().setCustomId(`game:flip:${gameId}`).setLabel('قلب اللوحة').setStyle(ButtonStyle.Secondary), 'flip')
  );

  const row2 = new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder().setCustomId(`game:history:${gameId}`).setLabel('السجل').setStyle(ButtonStyle.Secondary), 'history'),
    withEmoji(new ButtonBuilder().setCustomId(`game:hint:${gameId}`).setLabel('تلميح').setStyle(ButtonStyle.Secondary), 'hint')
  );
  if (canTakeback) {
    row2.addComponents(
      withEmoji(new ButtonBuilder().setCustomId(`game:takeback:${gameId}`).setLabel('طلب تراجع').setStyle(ButtonStyle.Secondary), 'takeback')
    );
  }

  return [row1, row2];
}

function buildPostGameRow(gameId) {
  return [
    new ActionRowBuilder().addComponents(
      withEmoji(new ButtonBuilder().setCustomId(`game:history:${gameId}`).setLabel('عرض سجل النقلات').setStyle(ButtonStyle.Secondary), 'history'),
      withEmoji(new ButtonBuilder().setCustomId(`game:rematch:${gameId}`).setLabel('إعادة المباراة').setStyle(ButtonStyle.Primary), 'random')
    ),
  ];
}

function buildFromSquareSelect(gameId, game) {
  const squares = game.chess.movableSquares();
  const chunks = [];
  for (let i = 0; i < squares.length; i += 25) chunks.push(squares.slice(i, i + 25));
  return chunks.map((chunk, chunkIndex) => {
    const options = chunk.map((sq) => {
      const piece = game.chess.pieceAt(sq);
      return { label: squareLabel(sq, piece), value: sq };
    });
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`mv:from:${gameId}:${chunkIndex}`)
        .setPlaceholder(chunks.length > 1 ? `اختر القطعة — المجموعة ${chunkIndex + 1}/${chunks.length}` : 'اختر القطعة التي تريد تحريكها')
        .addOptions(options)
    );
  });
}

function buildToSquareSelect(gameId, from, targets) {
  const chunks = [];
  for (let i = 0; i < targets.length; i += 25) chunks.push(targets.slice(i, i + 25));
  return chunks.map((chunk, chunkIndex) => {
    const options = chunk.map((t) => {
      const opt = { label: t.square, value: t.square };
      if (t.capture && t.promotion) opt.description = 'نقلة أسر + ترقية';
      else if (t.capture) opt.description = 'نقلة أسر';
      else if (t.promotion) opt.description = 'ترقية بيدق';
      const iconName = t.promotion ? 'promote' : t.capture ? 'capture' : null;
      const e = iconName && emojiObj(iconName);
      if (e) opt.emoji = e;
      return opt;
    });
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`mv:to:${gameId}:${from}:${chunkIndex}`)
        .setPlaceholder(chunks.length > 1 ? `الوجهات ${chunkIndex + 1}/${chunks.length} — من ${from}` : `إلى أين تريد تحريك القطعة من ${from}؟`)
        .addOptions(options)
    );
  });
}

function buildPromotionSelect(gameId, from, to) {
  const pieces = [
    { label: 'ملكة (الأقوى غالبًا)', value: 'q' },
    { label: 'قلعة', value: 'r' },
    { label: 'فيل', value: 'b' },
    { label: 'حصان', value: 'n' },
  ];
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`mv:promo:${gameId}:${from}:${to}`)
      .setPlaceholder('رقّي البيدق إلى...')
      .addOptions(pieces)
  );
}

/** Confirm/Cancel row shown under a move-preview image, before it's played. */
function buildMoveConfirmRow(token) {
  return new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder().setCustomId(`mv:confirm:${token}`).setLabel('تأكيد النقلة').setStyle(ButtonStyle.Success), 'confirm'),
    withEmoji(new ButtonBuilder().setCustomId(`mv:cancel:${token}`).setLabel('رجوع').setStyle(ButtonStyle.Secondary), 'cancel')
  );
}

function buildTakebackOfferRow(gameId) {
  return new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder().setCustomId(`game:takeback:acc:${gameId}`).setLabel('قبول التراجع').setStyle(ButtonStyle.Success), 'confirm'),
    withEmoji(new ButtonBuilder().setCustomId(`game:takeback:dec:${gameId}`).setLabel('رفض').setStyle(ButtonStyle.Danger), 'cancel')
  );
}

function buildResignConfirmRow(gameId) {
  return new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder().setCustomId(`game:resign:confirm:${gameId}`).setLabel('نعم، استسلم').setStyle(ButtonStyle.Danger), 'resign'),
    new ButtonBuilder().setCustomId(`game:resign:cancel:${gameId}`).setLabel('تراجع').setStyle(ButtonStyle.Secondary)
  );
}

function buildDrawOfferRow(gameId) {
  return new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder().setCustomId(`game:draw:acc:${gameId}`).setLabel('قبول التعادل').setStyle(ButtonStyle.Success), 'confirm'),
    withEmoji(new ButtonBuilder().setCustomId(`game:draw:dec:${gameId}`).setLabel('رفض').setStyle(ButtonStyle.Danger), 'cancel')
  );
}

const LEVEL_ICON = {
  beginner: 'hint',
  novice: 'hint',
  casual: 'move',
  intermediate: 'move',
  advanced: 'capture',
  strong: 'capture',
  expert: 'check',
  master: 'trophy',
  legendary: 'ai',
};

function buildAILevelSelect(token) {
  const options = LEVELS.map((l) => {
    const opt = {
      label: `${l.label} • ELO ${l.elo}`,
      description: l.description.slice(0, 100),
      value: String(l.id),
    };
    const e = emojiObj(LEVEL_ICON[l.key]);
    if (e) opt.emoji = e;
    return opt;
  });
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`ai:level:${token}`)
      .setPlaceholder('اختر مستوى صعوبة البوت')
      .addOptions(options)
  );
}

function buildColorSelect(token, levelId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`ai:color:${token}:${levelId}`)
      .setPlaceholder('بأي لون تريد اللعب؟')
      .addOptions(
        { label: 'الأبيض (يبدأ أولًا)', value: 'w' },
        { label: 'الأسود', value: 'b' },
        { label: 'عشوائي', value: 'r' }
      )
  );
}

function buildMoveTypeModal(gameId) {
  const modal = new ModalBuilder().setCustomId(`mv:sanmodal:${gameId}`).setTitle('اكتب النقلة');
  const input = new TextInputBuilder()
    .setCustomId('san')
    .setLabel('النقلة (مثال: e4, Nf3, exd5, O-O)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(10);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

/**
 * Text shown under a player's name on the board: the bot's fixed ELO for
 * an AI side (the only place ELO still applies), or the human's Discord
 * handle for a human side. Player ELO/rating was intentionally removed —
 * ratings now exist only for bots.
 */
function subLabelFor(side) {
  if (side.isAI) {
    const level = getLevel(side.level);
    return level ? `ELO ${level.elo}` : '';
  }
  return side.username ? `@${side.username}` : '';
}

/** Renders the board and builds the full Components V2 payload for the main game message. */
async function buildGameView(game, opts = {}) {
  const buf = await renderGameImage(game.chess.chess, {
    flipped: game.flipped,
    lastMove: game.lastMove,
    selected: opts.selected || null,
    legalTargets: opts.legalTargets || [],
    whiteName: game.white.name,
    blackName: game.black.name,
    whiteSubLabel: opts.whiteSubLabel ?? subLabelFor(game.white),
    blackSubLabel: opts.blackSubLabel ?? subLabelFor(game.black),
    whiteAvatarURL: game.white.avatarURL || null,
    blackAvatarURL: game.black.avatarURL || null,
    whiteIsAI: !!game.white.isAI,
    blackIsAI: !!game.black.isAI,
    statusText: game.chess.statusText(),
    whiteIsTurn: game.chess.turn === 'w',
  });

  const over = game.chess.isGameOver() || game.status === 'finished';
  const rows = opts.rows ?? (over ? buildPostGameRow(game.id) : buildGameControlsRows(game.id));

  const titleLines = [
    `## ${emoji('capture')} شطرنج — لعبة مباشرة`,
    `**${game.white.name}** (أبيض) ${emoji('capture')} **${game.black.name}** (أسود)`,
  ];
  if (opts.note) titleLines.push('', `### ${opts.note}`);

  const attachment = new AttachmentBuilder(buf, { name: 'board.png' });
  const container = new ContainerBuilder()
    .setAccentColor(over ? COLOR_ENDED : COLOR_ACTIVE)
    .addTextDisplayComponents((td) => td.setContent(titleLines.join('\n')))
    .addMediaGalleryComponents((g) => g.addItems((i) => i.setURL('attachment://board.png')));
  for (const row of rows) container.addActionRowComponents(row);
  container
    .addSeparatorComponents((s) => s.setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents((td) =>
      td.setContent(over ? '-# انتهت اللعبة' : '-# اضغط زر «نقلة» للتحريك، أو «اكتب نقلة» إن كنت تفضّل الكتابة المباشرة')
    )
    .addTextDisplayComponents((td) => td.setContent(CREDIT_LINE));

  return {
    flags: opts.ephemeral ? V2_EPHEMERAL : V2,
    components: [container],
    files: [attachment],
  };
}

/**
 * Live preview of a move under consideration: renders the position
 * *after* the candidate move (on a throwaway clone) with an arrow from
 * the origin square to the destination, plus a short note on what the
 * move does (capture / check / checkmate / promotion). Nothing here has
 * been applied to the real game yet — that only happens on Confirm.
 */
async function buildMovePreviewView(game, previewChess, moveResult, token) {
  const { from, to, san, captured, promotion } = moveResult;
  const buf = await renderGameImage(previewChess.chess, {
    flipped: game.flipped,
    previewMove: { from, to, capture: !!captured },
    whiteName: game.white.name,
    blackName: game.black.name,
    whiteSubLabel: subLabelFor(game.white),
    blackSubLabel: subLabelFor(game.black),
    whiteAvatarURL: game.white.avatarURL || null,
    blackAvatarURL: game.black.avatarURL || null,
    whiteIsAI: !!game.white.isAI,
    blackIsAI: !!game.black.isAI,
    statusText: 'معاينة النقلة',
    whiteIsTurn: previewChess.turn === 'w',
  });

  const notes = [];
  if (captured) notes.push(`${emoji('capture')} أسر قطعة`);
  if (promotion) notes.push(`${emoji('promote')} ترقية بيدق`);
  if (previewChess.isCheckmate()) notes.push(`${emoji('checkmate')} كش ملك — تنهي اللعبة فورًا!`);
  else if (previewChess.inCheck()) notes.push(`${emoji('check')} كش!`);
  else if (previewChess.isStalemate()) notes.push(`${emoji('draw')} تؤدي لتعادل بالجمود`);

  const text = [
    `### ${emoji('move')} معاينة: ${san}`,
    `**${from} ← ${to}**${notes.length ? `\n${notes.join(' • ')}` : ''}`,
    '\nهل تريد لعب هذه النقلة؟',
  ].join('\n');

  return buildImageContainerPayload({
    accentColor: COLOR_INFO,
    text,
    imageBuffer: buf,
    imageName: 'preview.png',
    rows: [buildMoveConfirmRow(token)],
    ephemeral: true,
  });
}

/**
 * Live preview shown right after picking a piece to move: the real board
 * with that square highlighted and every legal destination marked (dot
 * for a quiet move, ring for a capture) — so the player can see exactly
 * where the piece can go before picking a destination.
 */
async function buildFromSelectionView(game, from, targets, gameId) {
  const buf = await renderGameImage(game.chess.chess, {
    flipped: game.flipped,
    lastMove: game.lastMove,
    selected: from,
    legalTargets: targets,
    whiteName: game.white.name,
    blackName: game.black.name,
    whiteSubLabel: subLabelFor(game.white),
    blackSubLabel: subLabelFor(game.black),
    whiteAvatarURL: game.white.avatarURL || null,
    blackAvatarURL: game.black.avatarURL || null,
    whiteIsAI: !!game.white.isAI,
    blackIsAI: !!game.black.isAI,
    statusText: `إلى أين تريد تحريك القطعة من ${from}؟`,
    whiteIsTurn: game.chess.turn === 'w',
  });

  const text = [
    `### ${emoji('move')} القطعة المختارة: ${from}`,
    'الدوائر الرمادية = نقلات عادية · الحلقات الحمراء = أسر',
    'اختر الوجهة من القائمة أدناه:',
  ].join('\n');

  return buildImageContainerPayload({
    accentColor: COLOR_INFO,
    text,
    imageBuffer: buf,
    imageName: 'preview.png',
    rows: buildToSquareSelect(gameId, from, targets),
    ephemeral: true,
  });
}

async function buildHintView(game, previewChess, moveResult) {
  const { from, to, san } = moveResult;
  const buf = await renderGameImage(previewChess.chess, {
    flipped: game.flipped,
    previewMove: { from, to, capture: !!moveResult.captured },
    whiteName: game.white.name,
    blackName: game.black.name,
    whiteSubLabel: subLabelFor(game.white),
    blackSubLabel: subLabelFor(game.black),
    whiteAvatarURL: game.white.avatarURL || null,
    blackAvatarURL: game.black.avatarURL || null,
    whiteIsAI: !!game.white.isAI,
    blackIsAI: !!game.black.isAI,
    statusText: 'تلميح قوي',
    whiteIsTurn: game.chess.turn === 'w',
  });
  const text = [
    `### ${emoji('hint')} التلميح المقترح`,
    `النقلة المقترحة: **${san}**  ·  **${from} ← ${to}**`,
    'التلميح لا يلعب النقلة تلقائيًا؛ القرار لك.',
  ].join('\n');
  return buildImageContainerPayload({
    accentColor: COLOR_INFO,
    text,
    imageBuffer: buf,
    imageName: 'hint.png',
    footer: CREDIT_LINE,
    ephemeral: true,
  });
}

/** Small arrow-only preview shown while a promotion choice is pending (final piece not known yet). */
async function buildPendingPromotionView(game, from, to, gameId) {
  const capture = !!game.chess.pieceAt(to);
  const buf = await renderGameImage(game.chess.chess, {
    flipped: game.flipped,
    previewMove: { from, to, capture },
    whiteName: game.white.name,
    blackName: game.black.name,
    whiteSubLabel: subLabelFor(game.white),
    blackSubLabel: subLabelFor(game.black),
    whiteAvatarURL: game.white.avatarURL || null,
    blackAvatarURL: game.black.avatarURL || null,
    whiteIsAI: !!game.white.isAI,
    blackIsAI: !!game.black.isAI,
    statusText: 'اختر قطعة الترقية',
    whiteIsTurn: game.chess.turn === 'w',
  });

  const text = [`### ${emoji('promote')} ترقية بيدق: ${from} ← ${to}`, 'اختر القطعة التي سيترقّى إليها البيدق:'].join('\n');

  return buildImageContainerPayload({
    accentColor: COLOR_INFO,
    text,
    imageBuffer: buf,
    imageName: 'preview.png',
    rows: [buildPromotionSelect(gameId, from, to)],
    ephemeral: true,
  });
}

/** Force any already-built payload from this module to be ephemeral (used
 *  when the same view — e.g. buildGameView — is reused in both a public
 *  and a "just for you" context). */
function asEphemeral(payload) {
  return { ...payload, flags: payload.flags | MessageFlags.Ephemeral };
}

module.exports = {
  simplePayload,
  asEphemeral,
  scheduleAutoDismiss,
  buildImageContainerPayload,
  buildChallengeView,
  buildGameControlsRows,
  buildPostGameRow,
  buildFromSquareSelect,
  buildToSquareSelect,
  buildPromotionSelect,
  buildMoveConfirmRow,
  buildTakebackOfferRow,
  buildResignConfirmRow,
  buildDrawOfferRow,
  buildAILevelSelect,
  buildColorSelect,
  buildMoveTypeModal,
  buildGameView,
  buildMovePreviewView,
  buildHintView,
  buildFromSelectionView,
  buildPendingPromotionView,
  COLOR_INFO,
  COLOR_ENDED,
  COLOR_ACTIVE,
  COLOR_DANGER,
  COLOR_SUCCESS,
  CREDIT_LINE,
  V2,
  V2_EPHEMERAL,
};
