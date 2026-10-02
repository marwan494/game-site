'use strict';

const GameManager = require('../game/GameManager');
const pendingMoves = require('../utils/pendingMoves');
const {
  buildFromSquareSelect,
  buildToSquareSelect,
  buildPromotionSelect,
  buildMoveTypeModal,
  buildMoveConfirmRow,
  buildGameView,
  buildFromSelectionView,
  buildMovePreviewView,
  buildPendingPromotionView,
  simplePayload,
  scheduleAutoDismiss,
  COLOR_DANGER,
  COLOR_SUCCESS,
  COLOR_INFO,
} = require('../ui/components');
const { emoji } = require('../utils/emojis');
const { afterMoveApplied } = require('../game/turnEngine');

function checkTurn(interaction, game) {
  const side = GameManager.sideOf(game, interaction.user.id);
  if (!side) return { ok: false, msg: 'أنت لست طرفًا في هذه اللعبة.' };
  if (side !== game.chess.turn) return { ok: false, msg: 'ليس دورك الآن.' };
  return { ok: true, side };
}

async function handleMoveOpen(interaction, gameId) {
  const game = GameManager.get(gameId);
  if (!game || game.status !== 'active') {
    return interaction.reply(simplePayload('انتهت هذه اللعبة.', { accentColor: COLOR_DANGER, ephemeral: true }));
  }
  const check = checkTurn(interaction, game);
  if (!check.ok) return interaction.reply(simplePayload(check.msg, { accentColor: COLOR_DANGER, ephemeral: true }));

  const view = await buildGameView(game, { rows: buildFromSquareSelect(gameId, game), ephemeral: true });
  await interaction.reply(view);
}

async function handleMoveTypeModalOpen(interaction, gameId) {
  const game = GameManager.get(gameId);
  if (!game || game.status !== 'active') {
    return interaction.reply(simplePayload('انتهت هذه اللعبة.', { accentColor: COLOR_DANGER, ephemeral: true }));
  }
  const check = checkTurn(interaction, game);
  if (!check.ok) return interaction.reply(simplePayload(check.msg, { accentColor: COLOR_DANGER, ephemeral: true }));

  await interaction.showModal(buildMoveTypeModal(gameId));
}

async function handleFromSelect(interaction, gameId) {
  const game = GameManager.get(gameId);
  if (!game || game.status !== 'active') {
    return interaction.update(simplePayload('انتهت هذه اللعبة.', { accentColor: COLOR_DANGER }));
  }
  const check = checkTurn(interaction, game);
  if (!check.ok) return interaction.update(simplePayload(check.msg, { accentColor: COLOR_DANGER }));

  const from = interaction.values[0];
  const targets = game.chess.legalTargets(from);
  if (!targets.length) {
    const view = await buildGameView(game, { rows: buildFromSquareSelect(gameId, game), ephemeral: true });
    return interaction.update(view);
  }

  // Live preview: highlight the chosen piece + every legal destination
  // right on the board, so the player can see where it can go before
  // picking a square.
  const view = await buildFromSelectionView(game, from, targets, gameId);
  await interaction.update(view);
}

async function handleToSelect(interaction, gameId, from) {
  const game = GameManager.get(gameId);
  if (!game || game.status !== 'active') {
    return interaction.update(simplePayload('انتهت هذه اللعبة.', { accentColor: COLOR_DANGER }));
  }
  const check = checkTurn(interaction, game);
  if (!check.ok) return interaction.update(simplePayload(check.msg, { accentColor: COLOR_DANGER }));

  const to = interaction.values[0];

  if (game.chess.requiresPromotion(from, to)) {
    const view = await buildPendingPromotionView(game, from, to, gameId);
    return interaction.update(view);
  }

  await showConfirmPreview(interaction, game, gameId, { from, to });
}

async function handlePromoSelect(interaction, gameId, from, to) {
  const game = GameManager.get(gameId);
  if (!game || game.status !== 'active') {
    return interaction.update(simplePayload('انتهت هذه اللعبة.', { accentColor: COLOR_DANGER }));
  }
  const check = checkTurn(interaction, game);
  if (!check.ok) return interaction.update(simplePayload(check.msg, { accentColor: COLOR_DANGER }));

  const promotion = interaction.values[0];
  await showConfirmPreview(interaction, game, gameId, { from, to, promotion });
}

/** Clone the game, try the candidate move, and — if legal — show the
 *  live "arrow + resulting position" preview with Confirm/Cancel. */
async function showConfirmPreview(interaction, game, gameId, moveInput) {
  const clone = game.chess.clone();
  const result = clone.move(moveInput);
  if (!result.ok) {
    return interaction.update(
      simplePayload(`${emoji('cancel')} نقلة غير صحيحة، حاول مرة أخرى.`, {
        accentColor: COLOR_DANGER,
        rows: buildFromSquareSelect(gameId, game),
      })
    );
  }

  const token = pendingMoves.create({
    gameId,
    userId: interaction.user.id,
    moveInput,
  });

  const view = await buildMovePreviewView(game, clone, result.move, token);
  await interaction.update(view);
}

async function handleMoveConfirm(interaction, token) {
  const pending = pendingMoves.get(token);
  if (!pending) {
    return interaction.update(
      simplePayload('انتهت صلاحية هذه المعاينة، جرّب النقلة من جديد.', { accentColor: COLOR_DANGER })
    );
  }
  const game = GameManager.get(pending.gameId);
  if (!game || game.status !== 'active') {
    return interaction.update(simplePayload('انتهت هذه اللعبة.', { accentColor: COLOR_DANGER }));
  }
  if (interaction.user.id !== pending.userId) {
    return interaction.reply(simplePayload('هذه المعاينة ليست لك.', { accentColor: COLOR_DANGER, ephemeral: true }));
  }
  // Consume only after authorization and game-state validation so another
  // user cannot burn someone else’s move token by clicking it.
  pendingMoves.remove(token);
  const check = checkTurn(interaction, game);
  if (!check.ok) return interaction.update(simplePayload(check.msg, { accentColor: COLOR_DANGER }));

  const result = game.chess.move(pending.moveInput);
  if (!result.ok) {
    return interaction.update(
      simplePayload(`${emoji('cancel')} لم تعد هذه النقلة صالحة (ربما تغيّر الوضع)، حاول مرة أخرى.`, { accentColor: COLOR_DANGER })
    );
  }
  game.lastMove = { from: result.move.from, to: result.move.to };
  await interaction.update(
    simplePayload(`${emoji('confirm')} تم لعب **${result.move.san}**`, { accentColor: COLOR_SUCCESS })
  );
  // Auto-dismiss this ephemeral confirmation shortly after it's shown —
  // the player already sees the real result on the public board, so
  // there's no reason to leave a "Dismiss message" prompt cluttering
  // their view. Fired-and-forgotten so it doesn't delay applying the
  // move / triggering the AI's reply below.
  scheduleAutoDismiss(interaction);
  await afterMoveApplied(interaction.client, game);
}

async function handleMoveCancel(interaction, token) {
  const pending = pendingMoves.get(token);
  if (pending && interaction.user.id !== pending.userId) {
    return interaction.reply(simplePayload('هذه المعاينة ليست لك.', { accentColor: COLOR_DANGER, ephemeral: true }));
  }
  pendingMoves.remove(token);

  const gameId = pending ? pending.gameId : null;
  const game = gameId && GameManager.get(gameId);
  if (!game || game.status !== 'active') {
    return interaction.update(simplePayload('تم الإلغاء.', { accentColor: COLOR_INFO }));
  }

  const view = await buildGameView(game, { rows: buildFromSquareSelect(gameId, game), ephemeral: true });
  await interaction.update(view);
}

async function handleSanModalSubmit(interaction, gameId) {
  const game = GameManager.get(gameId);
  if (!game || game.status !== 'active') {
    return interaction.reply(simplePayload('انتهت هذه اللعبة.', { accentColor: COLOR_DANGER, ephemeral: true }));
  }
  const check = checkTurn(interaction, game);
  if (!check.ok) return interaction.reply(simplePayload(check.msg, { accentColor: COLOR_DANGER, ephemeral: true }));

  const raw = interaction.fields.getTextInputValue('san').trim();

  const clone = game.chess.clone();
  const result = clone.move(raw);
  if (!result.ok) {
    const legal = game.chess.chess.moves().slice(0, 12).join('، ');
    return interaction.reply(
      simplePayload(
        `${emoji('cancel')} نقلة غير صحيحة: \`${raw}\`\nمن النقلات الممكنة: ${legal}${
          game.chess.chess.moves().length > 12 ? '…' : ''
        }`,
        { accentColor: COLOR_DANGER, ephemeral: true }
      )
    );
  }

  const token = pendingMoves.create({
    gameId,
    userId: interaction.user.id,
    moveInput: raw,
  });

  const view = await buildMovePreviewView(game, clone, result.move, token);
  await interaction.reply(view);
}

module.exports = {
  handleMoveOpen,
  handleMoveTypeModalOpen,
  handleFromSelect,
  handleToSelect,
  handlePromoSelect,
  handleMoveConfirm,
  handleMoveCancel,
  handleSanModalSubmit,
};
