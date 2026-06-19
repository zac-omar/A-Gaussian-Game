/**
 * gameState.js — Finite-state machine, game state, undo stack, and scoring
 * for the Gaussian Game (a linear-algebra row-reduction puzzle).
 *
 * Pure ES module: no DOM, no external dependencies beyond the local modules
 * imported below. The GameState class is the single source of truth for the
 * UI layer; it never touches the DOM itself.
 */

import { Matrix } from './matrix.js';
import { generatePuzzle, checkWin, countLockedPivots } from './solver.js';

/**
 * Difficulty presets. Each entry drives generatePuzzle and the win condition.
 * @type {Object<string, {label:string, rows:number, cols:number,
 *   targetForm:string, requireLeadingOne:boolean}>}
 */
export const DIFFICULTIES = {
  EASY:   { label: 'Easy (REF)',    rows: 3, cols: 4, targetForm: 'REF',  requireLeadingOne: false },
  MEDIUM: { label: 'Medium (RREF)', rows: 3, cols: 4, targetForm: 'RREF', requireLeadingOne: true  },
  HARD:   { label: 'Hard (RREF)',   rows: 4, cols: 5, targetForm: 'RREF', requireLeadingOne: true  },
};

/**
 * Valid FSM states.
 * @type {ReadonlyArray<string>}
 */
export const STATES = Object.freeze([
  'MENU', 'GENERATING', 'PLAYING', 'WON', 'LOST', 'RESULTS',
]);

export class GameState {
  constructor() {
    /** @type {string} current FSM state */
    this.state = 'MENU';
    /** @type {string|null} key into DIFFICULTIES */
    this.difficultyKey = null;
    /** @type {Matrix|null} the live working matrix */
    this.matrix = null;
    /** @type {Matrix|null} pristine copy of the starting matrix (for reset) */
    this.initialMatrix = null;
    /** @type {string|null} 'REF' | 'RREF' */
    this.targetForm = null;
    /** @type {number|null} augment bar column index */
    this.augmentCol = null;
    /** @type {number} par move count from the solver */
    this.parMoves = 0;
    /** @type {number} number of row operations applied this game */
    this.movesUsed = 0;
    /** @type {Matrix[]} undo stack: snapshots taken BEFORE each move */
    this.history = [];
    /** @type {number} total pivots in a fully solved matrix */
    this.totalPivots = 0;
  }

  /**
   * Start a fresh game at the given difficulty.
   * @param {string} difficultyKey - one of the keys of DIFFICULTIES.
   * @returns {object} the new snapshot (see getSnapshot).
   */
  newGame(difficultyKey) {
    const preset = DIFFICULTIES[difficultyKey];
    if (!preset) {
      throw new Error(`Unknown difficulty: ${difficultyKey}`);
    }

    this.state = 'GENERATING';
    this.difficultyKey = difficultyKey;

    const puzzle = generatePuzzle({
      rows: preset.rows,
      cols: preset.cols,
      targetForm: preset.targetForm,
      requireLeadingOne: preset.requireLeadingOne,
    });

    this.matrix = puzzle.matrix;
    this.initialMatrix = puzzle.matrix.clone();
    this.targetForm = puzzle.targetForm;
    this.augmentCol = puzzle.augmentCol;
    this.parMoves = puzzle.parMoves;

    this.movesUsed = 0;
    this.history = [];

    // totalPivots: the number of pivot positions a fully solved matrix has.
    // For an m x n matrix with an augment bar before the last column, the
    // coefficient block is (cols - 1) wide, so at most min(rows, cols - 1)
    // pivots exist. We use that upper bound as the denominator for progress.
    this.totalPivots = Math.min(this.matrix.rows, this.matrix.cols - 1);

    this.state = 'PLAYING';
    return this.getSnapshot();
  }

  /**
   * Apply an elementary row operation.
   * @param {{type:'swap'|'scale'|'combine', [k:string]:any}} op
   *   - swap:    { type:'swap', i, j }
   *   - scale:   { type:'scale', i, c }
   *   - combine: { type:'combine', target, source, c }
   * @returns {object} the new snapshot.
   * @throws {Error} if there is no active game, the op type is unknown, or the
   *   underlying Matrix op throws (e.g. scale by zero). On a throw, state,
   *   history, and movesUsed are left untouched.
   */
  applyOperation(op) {
    if (this.state !== 'PLAYING') {
      throw new Error('No active game');
    }
    if (!op || typeof op.type !== 'string') {
      throw new Error('Invalid operation');
    }

    // Compute the next matrix FIRST. If this throws, we have not mutated any
    // state, so the throw propagates cleanly with the game intact.
    let next;
    switch (op.type) {
      case 'swap':
        next = this.matrix.swapRows(op.i, op.j);
        break;
      case 'scale':
        next = this.matrix.scaleRow(op.i, op.c);
        break;
      case 'combine':
        next = this.matrix.combineRows(op.target, op.source, op.c);
        break;
      default:
        throw new Error(`Unknown operation type: ${op.type}`);
    }

    // Commit: only reached when the op succeeded.
    this.history.push(this.matrix.clone());
    this.matrix = next;
    this.movesUsed += 1;

    if (this.checkWinNow()) {
      this.state = 'WON';
    }

    return this.getSnapshot();
  }

  /**
   * Undo the most recent move, if any.
   * @returns {object} the new snapshot.
   */
  undo() {
    if (this.history.length > 0) {
      this.matrix = this.history.pop();
      this.movesUsed = Math.max(0, this.movesUsed - 1);
      if (this.state === 'WON') {
        this.state = 'PLAYING';
      }
    }
    return this.getSnapshot();
  }

  /**
   * Restore the starting matrix and clear progress.
   * @returns {object} the new snapshot.
   */
  reset() {
    if (this.initialMatrix) {
      this.matrix = this.initialMatrix.clone();
    }
    this.history = [];
    this.movesUsed = 0;
    this.state = 'PLAYING';
    return this.getSnapshot();
  }

  /**
   * Concede the current game.
   * @returns {object} the new snapshot.
   */
  giveUp() {
    this.state = 'LOST';
    return this.getSnapshot();
  }

  /**
   * @returns {boolean} whether the current matrix matches the target form.
   */
  checkWinNow() {
    if (!this.matrix || !this.targetForm) return false;
    return checkWin(this.matrix, this.targetForm);
  }

  /**
   * Progress toward the goal, in pivots.
   * @returns {{locked:number, total:number}}
   */
  getProgress() {
    const locked = this.matrix && this.targetForm
      ? countLockedPivots(this.matrix, this.targetForm)
      : 0;
    return { locked, total: this.totalPivots };
  }

  /**
   * Star rating for a completed game. Only meaningful when state === 'WON'.
   *   3 stars: movesUsed <= parMoves
   *   2 stars: movesUsed <= parMoves * 1.5
   *   1 star:  otherwise
   * @returns {{movesUsed:number, parMoves:number, stars:number}}
   */
  getScore() {
    let stars;
    if (this.movesUsed <= this.parMoves) {
      stars = 3;
    } else if (this.movesUsed <= this.parMoves * 1.5) {
      stars = 2;
    } else {
      stars = 1;
    }
    return { movesUsed: this.movesUsed, parMoves: this.parMoves, stars };
  }

  /**
   * A UI-friendly summary of the current state. The matrix is the live Matrix
   * object (callers may read it but should not mutate it directly).
   * @returns {{state:string, difficultyKey:string|null, targetForm:string|null,
   *   matrix:Matrix|null, augmentCol:number|null, movesUsed:number,
   *   parMoves:number, progress:{locked:number,total:number}, canUndo:boolean}}
   */
  getSnapshot() {
    return {
      state: this.state,
      difficultyKey: this.difficultyKey,
      targetForm: this.targetForm,
      matrix: this.matrix,
      augmentCol: this.augmentCol,
      movesUsed: this.movesUsed,
      parMoves: this.parMoves,
      progress: this.getProgress(),
      canUndo: this.history.length > 0,
    };
  }
}

// --- Example usage ---
// import { GameState, DIFFICULTIES } from './gameState.js';
// const game = new GameState();
// game.newGame('EASY');                       // state -> 'PLAYING'
// game.applyOperation({ type: 'swap', i: 0, j: 1 });   // movesUsed -> 1
// game.undo();                                // movesUsed -> 0, restores matrix
// game.reset();                               // back to the initial matrix
// console.log(game.getSnapshot());            // inspect current state
