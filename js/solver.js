/**
 * solver.js — REF/RREF detection and solvable-puzzle generation.
 *
 * Pure ES module, no DOM, no external dependencies. All arithmetic is exact
 * (via Fraction); zero-tests use Fraction.isZero() — never floating point.
 *
 * IMPORTANT: REF/RREF are analyzed over the WHOLE matrix `data` grid, INCLUDING
 * the augment column. The augment bar (`matrix.augmentCol`) is purely cosmetic
 * for win-detection — every column is treated as part of the matrix.
 */

import { Fraction } from './rational.js';
import { Matrix } from './matrix.js';

/**
 * Index of the first nonzero entry in row `rowIndex`, or -1 if the row is all
 * zeros. Operates over all columns (augment column included).
 * @param {Matrix} matrix
 * @param {number} rowIndex
 * @returns {number}
 */
export function leadingEntryCol(matrix, rowIndex) {
  for (let c = 0; c < matrix.cols; c++) {
    if (!matrix.data[rowIndex][c].isZero()) return c;
  }
  return -1;
}

/**
 * Is the matrix in row-echelon form?
 *
 * REF rules (over the whole grid):
 *   1. All all-zero rows are below every nonzero row.
 *   2. For consecutive nonzero rows, each leading entry is strictly to the
 *      RIGHT of the leading entry in the row above.
 *   3. If requireLeadingOne is true, every pivot (leading entry) equals 1.
 *
 * @param {Matrix} matrix
 * @param {{requireLeadingOne?: boolean}} [opts]
 * @returns {boolean}
 */
export function isREF(matrix, { requireLeadingOne = false } = {}) {
  let prevLead = -1;
  let seenZeroRow = false;

  for (let r = 0; r < matrix.rows; r++) {
    const lead = leadingEntryCol(matrix, r);

    if (lead === -1) {
      // All-zero row. Any nonzero row after this would violate rule 1.
      seenZeroRow = true;
      continue;
    }

    // Rule 1: a nonzero row may not appear after a zero row.
    if (seenZeroRow) return false;

    // Rule 2: strictly increasing leading-entry columns.
    if (lead <= prevLead) return false;

    // Rule 3 (optional): pivot must be 1.
    if (requireLeadingOne && !matrix.data[r][lead].isOne()) return false;

    prevLead = lead;
  }

  return true;
}

/**
 * Is the matrix in reduced row-echelon form?
 *
 * Must be in REF with leading ones AND every pivot must be the only nonzero
 * entry in its column (all other entries in that column are zero).
 *
 * @param {Matrix} matrix
 * @returns {boolean}
 */
export function isRREF(matrix) {
  if (!isREF(matrix, { requireLeadingOne: true })) return false;

  for (let r = 0; r < matrix.rows; r++) {
    const lead = leadingEntryCol(matrix, r);
    if (lead === -1) continue; // zero row: nothing to check

    // Every OTHER entry in the pivot column must be zero.
    for (let rr = 0; rr < matrix.rows; rr++) {
      if (rr === r) continue;
      if (!matrix.data[rr][lead].isZero()) return false;
    }
  }

  return true;
}

/**
 * Win check against a target form.
 * @param {Matrix} matrix
 * @param {'REF'|'RREF'} targetForm
 * @returns {boolean}
 */
export function checkWin(matrix, targetForm) {
  if (targetForm === 'RREF') return isRREF(matrix);
  // 'REF' uses the relaxed definition: leading ones are NOT required.
  return isREF(matrix);
}

/**
 * Count of pivot positions currently satisfying the target form's per-column
 * condition. Drives a progress bar, so it is a monotonic-ish heuristic that
 * grows as the player nears the solution.
 *
 * Definition:
 *   We walk rows top-to-bottom tracking the previous nonzero row's leading
 *   column. A row "locks" a pivot when its leading entry is strictly to the
 *   right of the previous locked leading column (i.e. the staircase is still
 *   valid up to and including this row). The first nonzero row always locks
 *   (its lead is strictly right of the sentinel -1).
 *
 *   - REF: that staircase condition alone locks the pivot.
 *   - RREF: additionally the pivot must equal 1 AND its column must be zero in
 *     every other row.
 *
 *   Once a row fails the staircase test we stop counting (later pivots can't be
 *   "locked in place" if the staircase is already broken above them), which
 *   keeps the count rising smoothly toward the full pivot count as the player
 *   sorts rows from the top down.
 *
 * @param {Matrix} matrix
 * @param {'REF'|'RREF'} targetForm
 * @returns {number}
 */
export function countLockedPivots(matrix, targetForm) {
  const wantRREF = targetForm === 'RREF';
  let prevLead = -1;
  let locked = 0;

  for (let r = 0; r < matrix.rows; r++) {
    const lead = leadingEntryCol(matrix, r);

    if (lead === -1) {
      // Zero row contributes no pivot; the staircase continues unaffected.
      continue;
    }

    // Staircase test: strictly to the right of the previous locked lead.
    if (lead <= prevLead) break;

    if (wantRREF) {
      // Pivot must be 1 and otherwise-zero column.
      if (!matrix.data[r][lead].isOne()) break;
      let columnClean = true;
      for (let rr = 0; rr < matrix.rows; rr++) {
        if (rr === r) continue;
        if (!matrix.data[rr][lead].isZero()) {
          columnClean = false;
          break;
        }
      }
      if (!columnClean) break;
    }

    locked++;
    prevLead = lead;
  }

  return locked;
}

// --- Internal helpers for puzzle generation ---

/** Random integer in [min, max] inclusive. */
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Random nonzero integer in [-mag, mag] (excluding 0). */
function randNonzero(mag) {
  let v = 0;
  while (v === 0) v = randInt(-mag, mag);
  return v;
}

/**
 * The whole-number scalars offered by the UI scalar chips. Any row operation
 * used to scramble a puzzle must be reversible using ONLY these values, so that
 * a player can undo the scramble with the chips they actually have.
 */
const ALLOWED_SCALARS = [-3, -2, -1, 1, 2, 3];

/** Random scalar drawn uniformly from {-3,-2,-1,1,2,3}. */
function randAllowedScalar() {
  return ALLOWED_SCALARS[randInt(0, ALLOWED_SCALARS.length - 1)];
}

/**
 * Build a clean matrix already in the target form, with small integer entries.
 *
 * We place `rows` pivots into strictly-increasing columns (a valid staircase).
 * For REF, the pivot is a small nonzero integer and entries strictly to the
 * right of a pivot are small integers (entries below/left of pivots are zero by
 * construction). For RREF, every pivot is 1 and its entire column is zero apart
 * from the pivot.
 */
function buildSolved(rows, cols, targetForm, maxCoef) {
  const grid = [];
  for (let r = 0; r < rows; r++) {
    grid.push(new Array(cols).fill(0));
  }

  const wantRREF = targetForm === 'RREF';

  // Choose strictly-increasing pivot columns, one per row, leaving room.
  const pivotCols = [];
  let nextCol = 0;
  for (let r = 0; r < rows; r++) {
    // Ensure enough columns remain for the rest of the pivots.
    const remaining = rows - r - 1;
    const maxStart = cols - 1 - remaining;
    if (nextCol > maxStart) {
      // No room for a pivot in this row -> leave it as a zero row.
      pivotCols.push(-1);
      continue;
    }
    const pc = randInt(nextCol, maxStart);
    pivotCols.push(pc);
    nextCol = pc + 1;

    // Pivot value.
    grid[r][pc] = wantRREF ? 1 : randNonzero(maxCoef) || 1;

    // Fill entries strictly to the right of the pivot with small integers.
    for (let c = pc + 1; c < cols; c++) {
      grid[r][c] = randInt(-maxCoef, maxCoef);
    }
  }

  if (wantRREF) {
    // Clear each pivot column above (entries strictly to the right that happen
    // to sit in another row's pivot column must be zeroed).
    for (let r = 0; r < rows; r++) {
      const pc = pivotCols[r];
      if (pc === -1) continue;
      for (let rr = 0; rr < rows; rr++) {
        if (rr === r) continue;
        grid[rr][pc] = 0;
      }
    }
  }

  return Matrix.fromNumbers(grid, null);
}

/**
 * Apply a single random invertible row operation to `m`, returning a new
 * Matrix.
 *
 * SOLVABILITY INVARIANT: every operation here must be reversible using ONLY the
 * whole-number scalar chips the UI offers, {-3,-2,-1,1,2,3}. That constrains the
 * scalars we may pick:
 *   - Swap: self-inverse, no scalar involved -> always safe.
 *   - Combine (target += c*source): reversed by (target += -c*source). Since the
 *     allowed set is symmetric (-c is in it for every c), ANY scalar from the
 *     set is safe.
 *   - Scale (row *= s): reversed by (row *= 1/s). The reciprocal 1/s is only in
 *     the allowed set when s = +/-1. +1 is a no-op, so the only useful, safe
 *     scale is s = -1 (negating a row, which is its own inverse).
 * Using anything outside these bounds (e.g. scaling by 2, which would need a
 * 1/2 chip to undo) is what produced fractional, unsolvable puzzles before.
 */
function scrambleOnce(m) {
  const rows = m.rows;
  const choice = rows > 1 ? randInt(0, 2) : 1; // no swap/combine if single row

  if (choice === 0) {
    // Swap two distinct rows.
    let i = randInt(0, rows - 1);
    let j = randInt(0, rows - 1);
    while (j === i) j = randInt(0, rows - 1);
    return m.swapRows(i, j);
  }

  if (choice === 1) {
    // Scale a row. Only s = -1 is reversible with the available chips (its
    // reverse is also -1), so negation is the single safe scaling move.
    const i = randInt(0, rows - 1);
    return m.scaleRow(i, -1);
  }

  // Combine: target := target + c * source, with c drawn from the allowed chip
  // set. Reversal uses -c, which is always in the set, so the move is solvable.
  let target = randInt(0, rows - 1);
  let source = randInt(0, rows - 1);
  while (source === target) source = randInt(0, rows - 1);
  const c = randAllowedScalar();
  return m.combineRows(target, source, c);
}

/**
 * Generate a guaranteed-solvable puzzle.
 *
 * Strategy: start from a matrix already in the target form (clean random
 * REF/RREF with small integer entries), then scramble it with `parMoves`
 * (4-7) random elementary row operations. Every row operation is invertible,
 * so the scrambled matrix is always reducible back to a valid solution.
 *
 * @param {{rows?:number, cols?:number, targetForm?:'REF'|'RREF',
 *          maxCoef?:number, augmentCol?:number|null}} [opts]
 * @returns {{matrix: Matrix, targetForm: string, augmentCol: number|null,
 *            parMoves: number}}
 */
export function generatePuzzle({
  rows = 3,
  cols = 4,
  targetForm = 'REF',
  maxCoef = 5,
  augmentCol = null,
} = {}) {
  // Default to the typical augmented-system bar (before the last column).
  const finalAugmentCol = augmentCol === null ? cols - 1 : augmentCol;

  const solved = buildSolved(rows, cols, targetForm, maxCoef);

  let parMoves = randInt(4, 7);
  let scrambled = solved;
  for (let i = 0; i < parMoves; i++) {
    scrambled = scrambleOnce(scrambled);
  }

  // Guard: if it happens to already satisfy the target form, scramble more.
  let extraGuard = 0;
  while (checkWin(scrambled, targetForm) && extraGuard < 10) {
    scrambled = scrambleOnce(scrambled);
    parMoves++;
    extraGuard++;
  }

  // Attach the cosmetic augment bar to the final puzzle matrix.
  scrambled = new Matrix(scrambled.data, finalAugmentCol);

  return { matrix: scrambled, targetForm, augmentCol: finalAugmentCol, parMoves };
}

// --- Example checks (commented out) ---
//
// import { Matrix } from './matrix.js';
//
// const ref = Matrix.fromNumbers([[1, 2, 3], [0, 1, 4], [0, 0, 1]]);
// console.log(isREF(ref));                          // true
// console.log(isREF(ref, { requireLeadingOne: true })); // true
//
// const notRef = Matrix.fromNumbers([[0, 0, 1], [1, 0, 0], [0, 1, 0]]);
// console.log(isREF(notRef));                       // false
//
// const rref = Matrix.fromNumbers([[1, 0, 0, 5], [0, 1, 0, 6], [0, 0, 1, 7]], 3);
// console.log(isRREF(rref));                        // true
// console.log(checkWin(rref, 'RREF'));              // true
//
// const p = generatePuzzle({ rows: 3, cols: 4, targetForm: 'RREF' });
// console.log(p.matrix.toString());
// console.log('par:', p.parMoves, 'solved already?', checkWin(p.matrix, 'RREF'));
// console.log('locked pivots:', countLockedPivots(p.matrix, p.targetForm));
