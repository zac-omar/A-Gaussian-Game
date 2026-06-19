/**
 * main.js — Game loop orchestration for the Gaussian Game.
 *
 * Owns the GameState, listens for UI intents, applies row operations, syncs the
 * UI after each move, and persists high scores to localStorage.
 *
 * Interaction model:
 *   1. Player picks an operation (Swap / Scale / Combine). Rows become tappable.
 *   2. Swap:    tap two distinct rows -> swap.
 *      Scale:   tap one row, then pick a scalar chip -> scale that row.
 *      Combine: tap target row, tap source row, then a scalar chip ->
 *               target := target + c * source.
 */

import { GameState, DIFFICULTIES } from './gameState.js';
import * as ui from './ui.js';

const HS_KEY = 'gaussian-game-highscores';

const game = new GameState();

/** Transient interaction state (cleared each time an op completes/cancels). */
let pendingOp = null;       // 'swap' | 'scale' | 'combine' | null
let selectedRows = [];      // tapped row indices, in order
let pendingScalar = null;   // chosen scalar string (Scale/Combine)

// --- High score persistence ---

function loadHighScores() {
  try {
    return JSON.parse(localStorage.getItem(HS_KEY)) || {};
  } catch {
    return {};
  }
}

function saveHighScore(difficultyKey, movesUsed) {
  const scores = loadHighScores();
  const prev = scores[difficultyKey];
  let improved = false;
  if (prev === undefined || movesUsed < prev) {
    scores[difficultyKey] = movesUsed;
    improved = true;
    try {
      localStorage.setItem(HS_KEY, JSON.stringify(scores));
    } catch {
      /* storage unavailable — ignore */
    }
  }
  return { best: scores[difficultyKey], improved };
}

// --- Rendering ---

function difficultyLabel() {
  return DIFFICULTIES[game.difficultyKey]?.label ?? '';
}

/** Re-render the whole game view from the current GameState snapshot. */
function syncUI(snap = game.getSnapshot()) {
  ui.renderInfo(snap, difficultyLabel());

  const locked = snap.matrix ? ui.lockedPivotRows(snap.matrix) : new Set();
  ui.renderMatrix(snap.matrix, snap.augmentCol, {
    selected: selectedRows,
    lockedRows: locked,
    rowsTappable: pendingOp !== null,
  });

  ui.setActiveOp(pendingOp);
  if (pendingOp === 'scale' || pendingOp === 'combine') {
    ui.showScalarSelector(pendingScalar);
  } else {
    ui.hideScalarSelector();
  }
}

// --- Interaction reset ---

function clearPending() {
  pendingOp = null;
  selectedRows = [];
  pendingScalar = null;
}

// --- Status hints ---

function updateStatus() {
  if (!pendingOp) {
    ui.setStatus('Pick an operation: Swap, Scale, or Combine.');
    return;
  }
  if (pendingOp === 'swap') {
    ui.setStatus(
      selectedRows.length === 0
        ? 'Swap: tap the first row.'
        : 'Swap: tap a second row to exchange.'
    );
  } else if (pendingOp === 'scale') {
    ui.setStatus(
      selectedRows.length === 0
        ? 'Scale: tap a row, then choose a multiplier.'
        : 'Scale: choose a multiplier for the selected row.'
    );
  } else if (pendingOp === 'combine') {
    if (selectedRows.length === 0) ui.setStatus('Combine: tap the target row (the one that changes).');
    else if (selectedRows.length === 1) ui.setStatus('Combine: tap the source row to add from.');
    else ui.setStatus('Combine: choose how many times to add the source row.');
  }
}

// --- Operation completion ---

/**
 * Try to apply the fully-specified pending operation. Returns true if an op was
 * applied (or attempted), false if more input is still needed.
 */
function tryComplete() {
  let op = null;
  if (pendingOp === 'swap' && selectedRows.length === 2) {
    op = { type: 'swap', i: selectedRows[0], j: selectedRows[1] };
  } else if (pendingOp === 'scale' && selectedRows.length === 1 && pendingScalar) {
    op = { type: 'scale', i: selectedRows[0], c: pendingScalar };
  } else if (pendingOp === 'combine' && selectedRows.length === 2 && pendingScalar) {
    op = { type: 'combine', target: selectedRows[0], source: selectedRows[1], c: pendingScalar };
  }
  if (!op) return false;

  try {
    const snap = game.applyOperation(op);
    clearPending();
    syncUI(snap);
    updateStatus();
    if (snap.state === 'WON') {
      ui.flashWin();
      setTimeout(handleWin, 700);
    } else {
      ui.flashValid();
    }
  } catch (err) {
    // e.g. scale by zero shouldn't happen (no 0 chip), but stay safe.
    ui.flashInvalid();
    ui.setStatus(`Invalid move: ${err.message}`);
    clearPending();
    syncUI();
  }
  return true;
}

function handleWin() {
  const score = game.getScore();
  const { best, improved } = saveHighScore(game.difficultyKey, score.movesUsed);
  const hsText = improved
    ? `New best for ${difficultyLabel()}: ${best} moves!`
    : `Best for ${difficultyLabel()}: ${best} moves.`;
  ui.showResult({
    won: true,
    stars: score.stars,
    movesUsed: score.movesUsed,
    parMoves: score.parMoves,
    highScoreText: hsText,
  });
}

// --- UI callbacks ---

const callbacks = {
  onDifficulty(key) {
    const snap = game.newGame(key);
    clearPending();
    ui.hideModal();
    ui.showGame();
    syncUI(snap);
    updateStatus();
    ui.setStatus(`${DIFFICULTIES[key].label}. Reduce the matrix to ${snap.targetForm}.`);
  },

  onOpSelect(op) {
    // Toggle off if the same op is tapped again.
    if (pendingOp === op) {
      clearPending();
    } else {
      pendingOp = op;
      selectedRows = [];
      pendingScalar = null;
    }
    syncUI();
    updateStatus();
  },

  onRowTap(rowIndex) {
    if (!pendingOp) return;

    if (pendingOp === 'swap') {
      if (selectedRows[0] === rowIndex) {
        selectedRows = []; // deselect
      } else if (selectedRows.length === 0) {
        selectedRows = [rowIndex];
      } else {
        selectedRows = [selectedRows[0], rowIndex];
      }
    } else if (pendingOp === 'scale') {
      selectedRows = selectedRows[0] === rowIndex ? [] : [rowIndex];
    } else if (pendingOp === 'combine') {
      if (selectedRows[0] === rowIndex) {
        selectedRows = [];
      } else if (selectedRows.length === 0) {
        selectedRows = [rowIndex];
      } else if (selectedRows[1] === rowIndex) {
        selectedRows = [selectedRows[0]];
      } else {
        selectedRows = [selectedRows[0], rowIndex];
      }
    }

    if (!tryComplete()) {
      syncUI();
      updateStatus();
    }
  },

  onScalar(value) {
    if (pendingOp !== 'scale' && pendingOp !== 'combine') return;
    pendingScalar = pendingScalar === value ? null : value;
    if (!tryComplete()) {
      syncUI();
      updateStatus();
    }
  },

  onUndo() {
    const snap = game.undo();
    clearPending();
    syncUI(snap);
    updateStatus();
  },

  onReset() {
    const snap = game.reset();
    clearPending();
    ui.hideModal();
    syncUI(snap);
    updateStatus();
  },

  onGiveUp() {
    const snap = game.giveUp();
    clearPending();
    syncUI(snap);
    ui.showResult({
      won: false,
      stars: 0,
      movesUsed: snap.movesUsed,
      parMoves: snap.parMoves,
      highScoreText: '',
    });
  },

  onMenu() {
    clearPending();
    game.state = 'MENU';
    ui.hideModal();
    ui.showMenu();
  },

  onPlayAgain() {
    const key = game.difficultyKey;
    ui.hideModal();
    if (key) callbacks.onDifficulty(key);
    else ui.showMenu();
  },
};

// --- Boot ---

ui.init(callbacks);
ui.showMenu();
