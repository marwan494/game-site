'use strict';

const { Chess } = require('chess.js');

/**
 * Thin convenience layer over chess.js (which already implements the full
 * official rulebook: legal move generation, castling, en passant,
 * promotion, check/checkmate/stalemate, threefold repetition, the
 * 50-move rule, and insufficient-material draws).
 */
class ChessGame {
  constructor(fen) {
    this.chess = fen ? new Chess(fen) : new Chess();
  }

  get turn() {
    return this.chess.turn(); // 'w' | 'b'
  }

  fen() {
    return this.chess.fen();
  }

  pgn() {
    return this.chess.pgn();
  }

  /** Rebuild an exact position while preserving move/repetition history. */
  loadHistory(sanMoves = []) {
    const chess = new Chess();
    for (const san of sanMoves) {
      const move = chess.move(san);
      if (!move) throw new Error(`Unable to replay persisted SAN move: ${san}`);
    }
    this.chess = chess;
    return this;
  }

  board() {
    return this.chess.board();
  }

  /** Independent copy of the current position — safe to mutate for previews. */
  clone() {
    return new ChessGame(this.fen());
  }

  /** Squares that currently have at least one legal move. */
  movableSquares() {
    const moves = this.chess.moves({ verbose: true });
    const set = new Set(moves.map((m) => m.from));
    return [...set];
  }

  pieceAt(square) {
    return this.chess.get(square);
  }

  /** Legal destinations for a given square, with capture + promotion flags. */
  legalTargets(square) {
    const moves = this.chess.moves({ square, verbose: true });
    const bySquare = new Map();
    for (const m of moves) {
      if (!bySquare.has(m.to)) {
        bySquare.set(m.to, { square: m.to, capture: !!m.captured, promotion: !!m.promotion });
      }
    }
    return [...bySquare.values()];
  }

  requiresPromotion(from, to) {
    return this.chess.moves({ square: from, verbose: true }).some((m) => m.to === to && m.promotion);
  }

  /**
   * @returns {{ok:true, move}|{ok:false, error:string}}
   */
  move(input) {
    try {
      const result = this.chess.move(input);
      if (!result) return { ok: false, error: 'invalid' };
      return { ok: true, move: result };
    } catch (e) {
      return { ok: false, error: 'invalid' };
    }
  }

  moveUci(uci) {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci.slice(4) : undefined;
    return this.move({ from, to, promotion });
  }

  undo() {
    return this.chess.undo();
  }

  inCheck() {
    return this.chess.inCheck();
  }

  isGameOver() {
    return this.chess.isGameOver();
  }

  isCheckmate() {
    return this.chess.isCheckmate();
  }

  isStalemate() {
    return this.chess.isStalemate();
  }

  isDraw() {
    return this.chess.isDraw();
  }

  isThreefoldRepetition() {
    return this.chess.isThreefoldRepetition();
  }

  isInsufficientMaterial() {
    return this.chess.isInsufficientMaterial();
  }

  history(opts) {
    return this.chess.history(opts);
  }

  /** Arabic-language description of why the game ended, or null if still active.
   *  Plain text only — this string is also drawn directly onto the board
   *  PNG via the canvas banner, which can't render Discord emoji tags. */
  outcomeText() {
    if (!this.isGameOver()) return null;
    if (this.isCheckmate()) {
      const winner = this.turn === 'w' ? 'الأسود' : 'الأبيض';
      return `كش ملك! ${winner} يفوز`;
    }
    if (this.isStalemate()) return 'تعادل بالجمود (Stalemate)';
    if (this.isThreefoldRepetition()) return 'تعادل بتكرار الوضعية 3 مرات';
    if (this.isInsufficientMaterial()) return 'تعادل — لا توجد قطع كافية للفوز';
    if (this.chess.isDrawByFiftyMoves && this.chess.isDrawByFiftyMoves()) {
      return 'تعادل — قاعدة الخمسين نقلة';
    }
    if (this.isDraw()) return 'تعادل';
    return 'انتهت اللعبة';
  }

  /** Short Arabic status line for the board header while the game is active. */
  statusText() {
    if (this.isGameOver()) return this.outcomeText();
    const side = this.turn === 'w' ? 'الأبيض' : 'الأسود';
    if (this.inCheck()) return `كش! دور ${side}`;
    return `دور ${side}`;
  }
}

module.exports = ChessGame;
