'use strict';

const GameManager = require('../game/GameManager');
const {
  buildResignConfirmRow,
  buildDrawOfferRow,
  buildTakebackOfferRow,
  buildHintView,
  simplePayload,
  scheduleAutoDismiss,
  COLOR_INFO,
  COLOR_DANGER,
  COLOR_SUCCESS,
} = require('../ui/components');
const { emoji } = require('../utils/emojis');
const { finalizeGame, refreshBoardMessage, bothAreAI } = require('../game/turnEngine');

function requireHumanTurnless(interaction, game) {
  // For resign/draw/flip we only require the user to be ONE of the two
  // human players (not necessarily their turn).
  const side = GameManager.sideOf(game, interaction.user.id);
  if (!side) return null;
  return side;
}

async function handleResignButton(interaction, gameId) {
  const game = GameManager.get(gameId);
  if (!game || game.status !== 'active') {
    return interaction.reply(simplePayload('انتهت هذه اللعبة.', { accentColor: COLOR_DANGER, ephemeral: true }));
  }
  const side = requireHumanTurnless(interaction, game);
  if (!side) {
    return interaction.reply(simplePayload('أنت لست طرفًا في هذه اللعبة.', { accentColor: COLOR_DANGER, ephemeral: true }));
  }

  await interaction.reply(
    simplePayload('هل أنت متأكد من الاستسلام؟', {
      accentColor: COLOR_DANGER,
      ephemeral: true,
      rows: [buildResignConfirmRow(gameId)],
    })
  );
}

async function handleResignConfirm(interaction, gameId) {
  const game = GameManager.get(gameId);
  if (!game || game.status !== 'active') {
    return interaction.update(simplePayload('انتهت هذه اللعبة.', { accentColor: COLOR_DANGER }));
  }
  const side = requireHumanTurnless(interaction, game);
  if (!side) return interaction.update(simplePayload('أنت لست طرفًا في هذه اللعبة.', { accentColor: COLOR_DANGER }));

  await interaction.update(simplePayload(`${emoji('resign')} تم الاستسلام.`, { accentColor: COLOR_DANGER }));
  scheduleAutoDismiss(interaction);
  const winner = side === 'w' ? 'b' : 'w';
  const loserName = side === 'w' ? game.white.name : game.black.name;
  await finalizeGame(interaction.client, game, winner, `${loserName} استسلم ${emoji('resign')}`);
}

async function handleResignCancel(interaction, gameId) {
  const game = GameManager.get(gameId);
  if (game && game.status === 'active') {
    const side = requireHumanTurnless(interaction, game);
    if (!side) {
      return interaction.reply(simplePayload('أنت لست طرفًا في هذه اللعبة.', { accentColor: COLOR_DANGER, ephemeral: true }));
    }
  }
  await interaction.update(simplePayload('تم التراجع عن الاستسلام.', { accentColor: COLOR_INFO }));
  scheduleAutoDismiss(interaction);
}

async function handleDrawOffer(interaction, gameId) {
  const game = GameManager.get(gameId);
  if (!game || game.status !== 'active') {
    return interaction.reply(simplePayload('انتهت هذه اللعبة.', { accentColor: COLOR_DANGER, ephemeral: true }));
  }
  if (bothAreAI(game)) {
    return interaction.reply(
      simplePayload('لا يوجد لاعب آخر لعرض التعادل عليه.', { accentColor: COLOR_DANGER, ephemeral: true })
    );
  }
  const side = requireHumanTurnless(interaction, game);
  if (!side) {
    return interaction.reply(simplePayload('أنت لست طرفًا في هذه اللعبة.', { accentColor: COLOR_DANGER, ephemeral: true }));
  }

  const opponent = side === 'w' ? game.black : game.white;

  if (opponent.isAI) {
    // Simple heuristic: AI accepts a draw if it isn't clearly ahead.
    let accept = true;
    try {
      const engine = await GameManager.ensureEngine(game);
      const cp = await engine.evaluate(game.chess.fen(), 250);
      // cp is from the side-to-move's perspective; normalize to AI's perspective.
      const aiSide = opponent === game.white ? 'w' : 'b';
      const aiCp = game.chess.turn === aiSide ? cp : -cp;
      accept = aiCp <= 40; // AI declines only if it's meaningfully better
    } catch (e) {
      accept = true;
    }
    if (accept) {
      await interaction.reply(simplePayload(`${emoji('draw')} وافق البوت على التعادل.`, { accentColor: COLOR_SUCCESS }));
      await finalizeGame(interaction.client, game, 'draw', `تعادل باتفاق اللاعبين ${emoji('draw')}`);
    } else {
      await interaction.reply(
        simplePayload(`${emoji('ai')} البوت رفض عرض التعادل — يرى أن موقفه أفضل.`, { accentColor: COLOR_INFO })
      );
    }
    return;  }

  game.drawOfferBy = side;
  GameManager.persist(game.id);
  await interaction.reply(
    simplePayload(`<@${opponent.id}> عُرض عليك تعادل من <@${interaction.user.id}>.`, {
      accentColor: COLOR_INFO,
      rows: [buildDrawOfferRow(gameId)],
    })
  );
}

async function handleDrawAccept(interaction, gameId) {
  const game = GameManager.get(gameId);
  if (!game || game.status !== 'active') {
    return interaction.update(simplePayload('انتهت هذه اللعبة.', { accentColor: COLOR_DANGER }));
  }
  if (!game.drawOfferBy) {
    return interaction.reply(
      simplePayload('لا يوجد عرض تعادل معلّق الآن.', { accentColor: COLOR_DANGER, ephemeral: true })
    );
  }
  const side = requireHumanTurnless(interaction, game);
  if (!side || side === game.drawOfferBy) {
    return interaction.reply(
      simplePayload('فقط الطرف الآخر يمكنه قبول العرض.', { accentColor: COLOR_DANGER, ephemeral: true })
    );
  }
  await interaction.update(simplePayload(`${emoji('draw')} تم قبول التعادل.`, { accentColor: COLOR_SUCCESS }));
  await finalizeGame(interaction.client, game, 'draw', `تعادل باتفاق اللاعبين ${emoji('draw')}`);
}

async function handleDrawDecline(interaction, gameId) {
  const game = GameManager.get(gameId);
  if (!game || game.status !== 'active') {
    return interaction.update(simplePayload('انتهت هذه اللعبة.', { accentColor: COLOR_DANGER }));
  }
  if (!game.drawOfferBy) {
    return interaction.reply(
      simplePayload('لا يوجد عرض تعادل معلّق الآن.', { accentColor: COLOR_DANGER, ephemeral: true })
    );
  }
  const side = requireHumanTurnless(interaction, game);
  if (!side || side === game.drawOfferBy) {
    return interaction.reply(
      simplePayload('فقط الطرف الآخر يمكنه رفض هذا العرض.', { accentColor: COLOR_DANGER, ephemeral: true })
    );
  }
  game.drawOfferBy = null;
  GameManager.persist(game.id);
  await interaction.update(simplePayload(`${emoji('cancel')} تم رفض عرض التعادل.`, { accentColor: COLOR_DANGER }));
}

async function handleHint(interaction, gameId) {
  const game = GameManager.get(gameId);
  if (!game || game.status !== 'active') {
    return interaction.reply(simplePayload('انتهت هذه اللعبة.', { accentColor: COLOR_DANGER, ephemeral: true }));
  }
  const side = GameManager.sideOf(game, interaction.user.id);
  if (!side) return interaction.reply(simplePayload('أنت لست طرفًا في هذه اللعبة.', { accentColor: COLOR_DANGER, ephemeral: true }));
  if (side !== game.chess.turn) return interaction.reply(simplePayload('التلميح متاح فقط أثناء دورك.', { accentColor: COLOR_DANGER, ephemeral: true }));

  try {
    const engine = await GameManager.ensureEngine(game);
    const uci = await engine.bestMove(game.chess.fen(), { movetimeMs: 500 });
    const preview = game.chess.clone();
    const result = preview.moveUci(uci);
    if (!result.ok) throw new Error(`Invalid hint move: ${uci}`);
    return interaction.reply(await buildHintView(game, preview, result.move));
  } catch (e) {
    console.error('Hint failed:', e);
    return interaction.reply(simplePayload('تعذر تجهيز التلميح الآن، حاول بعد لحظة.', { accentColor: COLOR_DANGER, ephemeral: true }));
  }
}

async function handleFlip(interaction, gameId) {
  const game = GameManager.get(gameId);
  if (!game || game.status !== 'active') {
    return interaction.reply(simplePayload('انتهت هذه اللعبة.', { accentColor: COLOR_DANGER, ephemeral: true }));
  }
  game.flipped = !game.flipped;
  GameManager.persist(game.id);
  await interaction.deferUpdate();
  await refreshBoardMessage(interaction.client, game);
}

/** Show the full move list (SAN) as a compact PGN-style card. */
async function handleHistory(interaction, gameId) {
  const game = GameManager.get(gameId);
  if (!game) {
    return interaction.reply(simplePayload('هذه اللعبة لم تعد متاحة.', { accentColor: COLOR_DANGER, ephemeral: true }));
  }

  const sanList = game.chess.history();
  if (!sanList.length) {
    return interaction.reply(
      simplePayload('لم تُلعب أي نقلة بعد في هذه اللعبة.', { accentColor: COLOR_INFO, ephemeral: true })
    );
  }

  const pairs = [];
  for (let i = 0; i < sanList.length; i += 2) {
    const num = i / 2 + 1;
    const white = sanList[i];
    const black = sanList[i + 1];
    pairs.push(black ? `${num}. ${white} ${black}` : `${num}. ${white}`);
  }
  let text = pairs.join('  ');
  if (text.length > 3500) text = text.slice(0, 3500) + '…';

  const body = [
    `### ${emoji('history')} سجل النقلات`,
    `**${game.white.name}** ${emoji('capture')} **${game.black.name}**`,
    '',
    '```',
    text,
    '```',
    `-# ${sanList.length} نقلة إجمالًا`,
  ].join('\n');

  await interaction.reply(simplePayload(body, { accentColor: COLOR_INFO, ephemeral: true }));
}

/** Plies to undo so the position lands back on `side`'s turn to move. */
function pliesToUndo(game, side) {
  return game.chess.turn === side ? 2 : 1;
}

function undoPlies(game, plies) {
  for (let i = 0; i < plies; i++) game.chess.undo();
  const hist = game.chess.chess.history({ verbose: true });
  const last = hist[hist.length - 1];
  game.lastMove = last ? { from: last.from, to: last.to } : null;
}

/** Ask to take back your last move. Auto-accepted instantly against the AI; needs opponent approval in PvP. */
async function handleTakebackRequest(interaction, gameId) {
  const game = GameManager.get(gameId);
  if (!game || game.status !== 'active') {
    return interaction.reply(simplePayload('انتهت هذه اللعبة.', { accentColor: COLOR_DANGER, ephemeral: true }));
  }
  const side = requireHumanTurnless(interaction, game);
  if (!side) {
    return interaction.reply(simplePayload('أنت لست طرفًا في هذه اللعبة.', { accentColor: COLOR_DANGER, ephemeral: true }));
  }

  const plies = pliesToUndo(game, side);
  if (game.chess.chess.history().length < plies) {
    return interaction.reply(
      simplePayload('لا توجد نقلات كافية للتراجع عنها بعد.', { accentColor: COLOR_DANGER, ephemeral: true })
    );
  }
  if (game.takebackOfferBy) {
    return interaction.reply(
      simplePayload('يوجد بالفعل طلب تراجع معلّق.', { accentColor: COLOR_DANGER, ephemeral: true })
    );
  }

  const opponent = side === 'w' ? game.black : game.white;

  if (opponent.isAI) {
    undoPlies(game, plies);
    GameManager.persist(game.id);
    await interaction.reply(
      simplePayload(`${emoji('takeback')} تم التراجع عن آخر نقلة.`, { accentColor: COLOR_SUCCESS, ephemeral: true })
    );
    scheduleAutoDismiss(interaction);
    await refreshBoardMessage(interaction.client, game);
    return;
  }

  game.takebackOfferBy = side;
  GameManager.persist(game.id);
  await interaction.reply(
    simplePayload(`<@${opponent.id}> طلب <@${interaction.user.id}> التراجع عن آخر نقلة.`, {
      accentColor: COLOR_INFO,
      rows: [buildTakebackOfferRow(gameId)],
    })
  );
}

async function handleTakebackAccept(interaction, gameId) {
  const game = GameManager.get(gameId);
  if (!game || game.status !== 'active') {
    return interaction.update(simplePayload('انتهت هذه اللعبة.', { accentColor: COLOR_DANGER }));
  }
  if (!game.takebackOfferBy) {
    return interaction.reply(
      simplePayload('لا يوجد طلب تراجع معلّق الآن.', { accentColor: COLOR_DANGER, ephemeral: true })
    );
  }
  const side = requireHumanTurnless(interaction, game);
  if (!side || side === game.takebackOfferBy) {
    return interaction.reply(
      simplePayload('فقط الطرف الآخر يمكنه قبول طلب التراجع.', { accentColor: COLOR_DANGER, ephemeral: true })
    );
  }
  const plies = Math.min(pliesToUndo(game, game.takebackOfferBy), game.chess.chess.history().length);
  game.takebackOfferBy = null;
  if (plies > 0) undoPlies(game, plies);
  GameManager.persist(game.id);

  await interaction.update(simplePayload(`${emoji('takeback')} تم قبول التراجع.`, { accentColor: COLOR_SUCCESS }));
  await refreshBoardMessage(interaction.client, game);
}

async function handleTakebackDecline(interaction, gameId) {
  const game = GameManager.get(gameId);
  if (!game || game.status !== 'active') {
    return interaction.update(simplePayload('انتهت هذه اللعبة.', { accentColor: COLOR_DANGER }));
  }
  if (!game.takebackOfferBy) {
    return interaction.reply(
      simplePayload('لا يوجد طلب تراجع معلّق الآن.', { accentColor: COLOR_DANGER, ephemeral: true })
    );
  }
  const side = requireHumanTurnless(interaction, game);
  if (!side || side === game.takebackOfferBy) {
    return interaction.reply(
      simplePayload('فقط الطرف الآخر يمكنه الرد على طلب التراجع.', { accentColor: COLOR_DANGER, ephemeral: true })
    );
  }
  game.takebackOfferBy = null;
  await interaction.update(simplePayload(`${emoji('cancel')} تم رفض طلب التراجع.`, { accentColor: COLOR_DANGER }));
}

async function handleRematch(interaction, gameId) {
  const source = gameId ? GameManager.get(gameId) : [...GameManager.games.values()].reverse().find((g) => g.channelId === interaction.channelId && g.status === 'finished');
  if (!source || source.status !== 'finished') {
    return interaction.reply(simplePayload('لا توجد مباراة منتهية قابلة للإعادة هنا.', { accentColor: COLOR_DANGER, ephemeral: true }));
  }
  if (!GameManager.sideOf(source, interaction.user.id)) {
    return interaction.reply(simplePayload('إعادة المباراة متاحة فقط للاعبين السابقين.', { accentColor: COLOR_DANGER, ephemeral: true }));
  }
  if (GameManager.findActiveByChannel(interaction.channelId)) {
    return interaction.reply(simplePayload('هناك مباراة نشطة بالفعل في هذه القناة.', { accentColor: COLOR_DANGER, ephemeral: true }));
  }

  const challenger = source.white;
  const opponent = source.black;
  const white = Math.random() < 0.5 ? challenger : opponent;
  const black = white === challenger ? opponent : challenger;
  const game = GameManager.createGame({ channelId: interaction.channelId, white, black, flipped: false });

  await interaction.deferUpdate();
  const view = await buildGameView(game, { rows: require('../ui/components').buildGameControlsRows(game.id) });
  let message;
  try {
    message = await interaction.channel.send(view);
  } catch (err) {
    GameManager.abort(game.id);
    console.error('Could not publish rematch board:', err);
    return interaction.followUp(
      simplePayload('تعذر نشر مباراة الإعادة. لم يتم إنشاء مباراة معلقة.', { accentColor: COLOR_DANGER, ephemeral: true })
    ).catch(() => {});
  }
  game.messageId = message.id;
  GameManager.persist(game.id);
  if (white.isAI) await require('../game/turnEngine').triggerAIMove(interaction.client, game);
}

module.exports = {
  handleResignButton,
  handleResignConfirm,
  handleResignCancel,
  handleDrawOffer,
  handleDrawAccept,
  handleDrawDecline,
  handleFlip,
  handleHistory,
  handleTakebackRequest,
  handleTakebackAccept,
  handleTakebackDecline,
  handleHint,
  handleRematch,
};
