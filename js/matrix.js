/**
 * matrix.js — Matrix model and elementary row operations.
 *
 * Pure ES module, no DOM, no external dependencies. Every cell is stored as a
 * Fraction (from rational.js) so all arithmetic is exact. Row operations are
 * immutable: each returns a brand-new Matrix and never mutates `this`.
 */

import { Fraction } from './rational.js';

export class Matrix {
  /**
   * @param {Array<Array<Fraction|number|string>>} data - rectangular 2D grid.
   *   Each entry is coerced through Fraction.from.
   * @param {number|null} augmentCol - column index where the augment bar is
   *   drawn (the bar appears *before* this column), or null for no bar.
   */
  constructor(data, augmentCol = null) {
    if (!Array.isArray(data) || data.length === 0 || !Array.isArray(data[0])) {
      throw new Error('Matrix data must be a non-empty 2D array');
    }

    const cols = data[0].length;
    for (const row of data) {
      if (!Array.isArray(row) || row.length !== cols) {
        throw new Error('Matrix rows must be equal length');
      }
    }

    this.rows = data.length;
    this.cols = cols;
    this.augmentCol = augmentCol;
    this.data = data.map((row) => row.map((cell) => Fraction.from(cell)));
  }

  /**
   * @param {number} r - row index
   * @param {number} c - column index
   * @returns {Fraction}
   */
  get(r, c) {
    this._checkRow(r);
    if (c < 0 || c >= this.cols) {
      throw new Error('Column index out of range');
    }
    return this.data[r][c];
  }

  /**
   * Deep copy: clones every Fraction and preserves augmentCol.
   * @returns {Matrix}
   */
  clone() {
    const copy = this.data.map((row) => row.map((cell) => cell.clone()));
    return new Matrix(copy, this.augmentCol);
  }

  /**
   * @param {Matrix} other
   * @returns {boolean} same dimensions and every cell equals.
   */
  equals(other) {
    if (!(other instanceof Matrix)) return false;
    if (this.rows !== other.rows || this.cols !== other.cols) return false;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (!this.data[r][c].equals(other.data[r][c])) return false;
      }
    }
    return true;
  }

  /**
   * 2D array of plain numbers (via Fraction.toNumber) — convenience/debugging.
   * @returns {number[][]}
   */
  toArray() {
    return this.data.map((row) => row.map((cell) => cell.toNumber()));
  }

  /**
   * Readable multi-line string. If augmentCol is set, ` | ` is drawn before
   * that column.
   * @returns {string}
   */
  toString() {
    const lines = this.data.map((row) => {
      const parts = [];
      for (let c = 0; c < this.cols; c++) {
        if (this.augmentCol !== null && c === this.augmentCol) {
          parts.push('|');
        }
        parts.push(row[c].toString());
      }
      return '[ ' + parts.join(' ') + ' ]';
    });
    return lines.join('\n');
  }

  // --- Elementary row operations (all return a NEW Matrix) ---

  /**
   * Exchange rows i and j.
   * @param {number} i
   * @param {number} j
   * @returns {Matrix}
   */
  swapRows(i, j) {
    this._checkRow(i);
    this._checkRow(j);
    const next = this.clone();
    const tmp = next.data[i];
    next.data[i] = next.data[j];
    next.data[j] = tmp;
    return next;
  }

  /**
   * Multiply row i by scalar c.
   * @param {number} i
   * @param {Fraction|number|string} c - must be non-zero.
   * @returns {Matrix}
   */
  scaleRow(i, c) {
    this._checkRow(i);
    const scalar = Fraction.from(c);
    if (scalar.isZero()) {
      throw new Error('Cannot scale row by zero');
    }
    const next = this.clone();
    next.data[i] = next.data[i].map((cell) => cell.mul(scalar));
    return next;
  }

  /**
   * Add c times the source row to the target row:
   *   row[target] := row[target] + c * row[source]
   * @param {number} target
   * @param {number} source
   * @param {Fraction|number|string} c
   * @returns {Matrix}
   */
  combineRows(target, source, c) {
    this._checkRow(target);
    this._checkRow(source);
    if (target === source) {
      throw new Error('combineRows: target and source must differ');
    }
    const scalar = Fraction.from(c);
    const next = this.clone();
    next.data[target] = next.data[target].map((cell, col) =>
      cell.add(next.data[source][col].mul(scalar))
    );
    return next;
  }

  /**
   * Throw if a row index is out of range.
   * @param {number} r
   * @private
   */
  _checkRow(r) {
    if (!Number.isInteger(r) || r < 0 || r >= this.rows) {
      throw new Error('Row index out of range');
    }
  }

  /**
   * Build a Matrix from a grid of plain numbers/strings.
   * @param {Array<Array<number|string>>} numberGrid
   * @param {number|null} augmentCol
   * @returns {Matrix}
   */
  static fromNumbers(numberGrid, augmentCol = null) {
    return new Matrix(numberGrid, augmentCol);
  }
}

// --- Example usage ---
// import { Matrix } from './matrix.js';
// const m = Matrix.fromNumbers([[2, 1, 5], [1, 3, 10]], 2); // bar before col 2
// const a = m.swapRows(0, 1);          // exchange rows 0 and 1
// const b = m.scaleRow(0, '1/2');      // halve row 0
// const c = m.combineRows(1, 0, -1);   // row1 := row1 + (-1) * row0
// console.log(m.toString());           // original is unchanged
// console.log(c.toString());           // [ 2 1 | 5 ] / [ -1 2 | 5 ]
// console.log(m.get(0, 0).toString()); // "2"
