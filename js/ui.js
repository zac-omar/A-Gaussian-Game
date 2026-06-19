/**
 * ui.js — UI component management for the Gaussian Game.
 *
 * Pure rendering + DOM event wiring. Holds NO game logic and never touches
 * GameState directly; main.js owns the game and calls these render functions
 * with snapshots, and registers callbacks for user intent.
 *
 * The DOM contract (ids/classes) matches index.html and styles.css.
 */

const $ = (id) => document.getElementById(id);

/** Cached DOM references, populated by init(). */
const dom = {};

/**
 * Callbacks supplied by main.js. The UI translates raw DOM events into these
 * high-level intents.
 * @type {{
 *   onDifficulty:(key:string)=>void,
 *   onOpSelect:(op:'swap'|'scale'|'combine')=>void,
 *   onRowTap:(rowIndex:number)=>void,
 *   onScalar:(value:string)=>void,
 *   onUndo:()=>void, onReset:()=>void, onGiveUp:()=>void, onMenu:()=>void,
 *   onPlayAgain:()=>void,
 * }}
 */
let cb = {};

/** Scalar chips offered for Scale / Combine. */
export const SCALARS = ['-3', '-2', '-1', '-1/2', '1/2', '1', '2', '3'];

/**
 * Cache DOM nodes and wire static event listeners.
 * @param {object} callbacks - see `cb` above.
 */
export function init(callbacks) {
  cb = callbacks || {};

  dom.menu = $('menu');
  dom.game = $('game');
  dom.difficultyLabel = $('difficulty-label');
  dom.targetForm = $('target-form');
  dom.movesCounter = $('moves-counter');
  dom.progress = $('progress');
  dom.progressBar = $('progress-bar');
  dom.progressText = $('progress-text');
  dom.board = $('matrix-board');
  dom.statusLine = $('status-line');
  dom.controls = $('controls');
  dom.opSwap = $('op-swap');
  dom.opScale = $('op-scale');
  dom.opCombine = $('op-combine');
  dom.scalarSelector = $('scalar-selector');
  dom.btnUndo = $('btn-undo');
  dom.btnReset = $('btn-reset');
  dom.btnGiveUp = $('btn-giveup');
  dom.btnMenu = $('btn-menu');
  dom.modal = $('result-modal');
  dom.resultTitle = $('result-title');
  dom.resultStars = $('result-stars');
  dom.resultStats = $('result-stats');
  dom.resultHighscore = $('result-highscore');
  dom.btnPlayAgain = $('btn-play-again');
  dom.btnResultMenu = $('btn-result-menu');

  // Difficulty buttons.
  document.querySelectorAll('.diff-btn').forEach((btn) => {
    btn.addEventListener('click', () => cb.onDifficulty?.(btn.dataset.difficulty));
  });

  // Operation buttons.
  dom.opSwap.addEventListener('click', () => cb.onOpSelect?.('swap'));
  dom.opScale.addEventListener('click', () => cb.onOpSelect?.('scale'));
  dom.opCombine.addEventListener('click', () => cb.onOpSelect?.('combine'));

  // Action buttons.
  dom.btnUndo.addEventListener('click', () => cb.onUndo?.());
  dom.btnReset.addEventListener('click', () => cb.onReset?.());
  dom.btnGiveUp.addEventListener('click', () => cb.onGiveUp?.());
  dom.btnMenu.addEventListener('click', () => cb.onMenu?.());

  // Modal buttons.
  dom.btnPlayAgain.addEventListener('click', () => cb.onPlayAgain?.());
  dom.btnResultMenu.addEventListener('click', () => cb.onMenu?.());
}

// --- Screen switching ---

export function showMenu() {
  dom.menu.hidden = false;
  dom.game.hidden = true;
  hideModal();
}

export function showGame() {
  dom.menu.hidden = true;
  dom.game.hidden = false;
}

// --- Matrix rendering ---

/**
 * Render the matrix grid into #matrix-board.
 * @param {import('./matrix.js').Matrix} matrix
 * @param {number|null} augmentCol
 * @param {object} [opts]
 * @param {number[]} [opts.selected] - selected row indices, in tap order
 *   ([] none, [r] primary, [r1,r2] primary+secondary).
 * @param {Set<number>} [opts.lockedRows] - row indices whose pivot is locked.
 * @param {boolean} [opts.rowsTappable] - whether rows respond to taps.
 */
export function renderMatrix(matrix, augmentCol, opts = {}) {
  const { selected = [], lockedRows = new Set(), rowsTappable = false } = opts;
  dom.board.innerHTML = '';

  const grid = document.createElement('div');
  grid.className = 'matrix';

  for (let r = 0; r < matrix.rows; r++) {
    const rowEl = document.createElement('div');
    rowEl.className = 'matrix-row';
    rowEl.dataset.row = String(r);

    if (selected[0] === r) rowEl.classList.add('selected', 'sel-primary');
    if (selected[1] === r) rowEl.classList.add('selected', 'sel-secondary');

    for (let c = 0; c < matrix.cols; c++) {
      if (augmentCol !== null && c === augmentCol) {
        const bar = document.createElement('div');
        bar.className = 'augment-bar';
        rowEl.appendChild(bar);
      }
      const cell = document.createElement('div');
      cell.className = 'matrix-cell';
      cell.textContent = matrix.get(r, c).toString();
      if (lockedRows.has(r)) cell.classList.add('pivot');
      rowEl.appendChild(cell);
    }

    if (rowsTappable) {
      rowEl.classList.add('tappable');
      rowEl.setAttribute('role', 'button');
      rowEl.setAttribute('tabindex', '0');
      rowEl.setAttribute('aria-label', `Row ${r + 1}`);
      rowEl.addEventListener('click', () => cb.onRowTap?.(r));
      // Add keyboard support for Enter and Space.
      rowEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          cb.onRowTap?.(r);
        }
      });
    }

    grid.appendChild(rowEl);
  }

  dom.board.appendChild(grid);
}

/**
 * Compute which rows currently hold a "locked" staircase pivot, mirroring
 * solver.countLockedPivots so the UI can highlight them. Returns a Set of row
 * indices.
 * @param {import('./matrix.js').Matrix} matrix
 * @returns {Set<number>}
 */
export function lockedPivotRows(matrix) {
  const rows = new Set();
  let prevLead = -1;
  for (let r = 0; r < matrix.rows; r++) {
    let lead = -1;
    for (let c = 0; c < matrix.cols; c++) {
      if (!matrix.get(r, c).isZero()) { lead = c; break; }
    }
    if (lead === -1) continue;
    if (lead <= prevLead) break;
    rows.add(r);
    prevLead = lead;
  }
  return rows;
}

// --- Info bar / progress ---

/**
 * Update the info bar and progress indicator from a snapshot.
 * @param {object} snap - GameState.getSnapshot()
 * @param {string} difficultyLabel - human label for the difficulty.
 */
export function renderInfo(snap, difficultyLabel) {
  dom.difficultyLabel.textContent = difficultyLabel;
  dom.targetForm.textContent = `Target: ${snap.targetForm}`;
  dom.movesCounter.textContent = `Moves: ${snap.movesUsed} / par ${snap.parMoves}`;

  const { locked, total } = snap.progress;
  const pct = total > 0 ? Math.round((locked / total) * 100) : 0;
  // styles.css models #progress-bar as the fill itself (width grows, with a
  // CSS width transition). #progress is the track.
  dom.progressBar.style.width = `${pct}%`;
  dom.progressText.textContent = `${locked} / ${total} pivots`;

  // Update progress bar ARIA for accessibility.
  dom.progress.setAttribute('aria-valuenow', String(pct));
  dom.progress.setAttribute('aria-valuetext', `${locked} of ${total} pivots`);

  dom.btnUndo.disabled = !snap.canUndo;
}

// --- Operation controls / scalar selector ---

/**
 * Reflect the currently selected operation on the op buttons.
 * @param {'swap'|'scale'|'combine'|null} op
 */
export function setActiveOp(op) {
  dom.opSwap.classList.toggle('active', op === 'swap');
  dom.opScale.classList.toggle('active', op === 'scale');
  dom.opCombine.classList.toggle('active', op === 'combine');

  // Update aria-pressed for accessibility.
  dom.opSwap.setAttribute('aria-pressed', op === 'swap');
  dom.opScale.setAttribute('aria-pressed', op === 'scale');
  dom.opCombine.setAttribute('aria-pressed', op === 'combine');
}

/**
 * Show the scalar chips (for Scale/Combine). Pass null to hide.
 * @param {string|null} selectedValue
 */
export function showScalarSelector(selectedValue = null) {
  dom.scalarSelector.hidden = false;
  dom.scalarSelector.innerHTML = '';
  for (const val of SCALARS) {
    const chip = document.createElement('button');
    chip.className = 'scalar-chip';
    chip.textContent = val;
    chip.dataset.value = val;
    if (val === selectedValue) chip.classList.add('selected');
    // Set aria-pressed and aria-label for accessibility.
    chip.setAttribute('aria-pressed', val === selectedValue);
    chip.setAttribute('aria-label', `Multiply by ${val}`);
    chip.addEventListener('click', () => cb.onScalar?.(val));
    dom.scalarSelector.appendChild(chip);
  }
}

export function hideScalarSelector() {
  dom.scalarSelector.hidden = true;
  dom.scalarSelector.innerHTML = '';
}

// --- Status line ---

/** @param {string} text */
export function setStatus(text) {
  dom.statusLine.textContent = text;
}

// --- Feedback animations ---

/** Brief green glow on the whole board (valid move landed). */
export function flashValid() {
  pulse(dom.board, 'glow', 600);
}

/** Quick shake (invalid input). */
export function flashInvalid() {
  pulse(dom.board, 'shake', 400);
}

/** Celebratory board flash on win. */
export function flashWin() {
  pulse(dom.board, 'win-flash', 1000);
}

function pulse(el, cls, ms) {
  if (!el) return;
  el.classList.remove(cls);
  // Force reflow so re-adding the class restarts the animation.
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), ms);
}

// --- Result modal ---

/**
 * Show the result modal.
 * @param {object} info
 * @param {boolean} info.won
 * @param {number} info.stars
 * @param {number} info.movesUsed
 * @param {number} info.parMoves
 * @param {string} info.highScoreText
 */
export function showResult(info) {
  dom.resultTitle.textContent = info.won ? 'Solved!' : 'Gave Up';

  // Render stars as individual span elements for staggered animation
  dom.resultStars.innerHTML = '';
  if (info.won) {
    const totalStars = 3;
    for (let i = 0; i < totalStars; i++) {
      const star = document.createElement('span');
      star.className = i < info.stars ? 'star' : 'star empty';
      star.textContent = i < info.stars ? '★' : '☆';
      star.style.animationDelay = `${i * 100}ms`;
      dom.resultStars.appendChild(star);
    }
  }

  dom.resultStats.textContent = info.won
    ? `You solved it in ${info.movesUsed} moves (par ${info.parMoves}).`
    : 'Better luck next time — try again!';
  dom.resultHighscore.textContent = info.highScoreText || '';
  dom.modal.hidden = false;
  // styles.css reveals the overlay via the .active class (opacity/visibility).
  dom.modal.classList.add('active');

  // Move focus to the primary button for keyboard users.
  dom.btnPlayAgain.focus();
}

export function hideModal() {
  dom.modal.classList.remove('active');
  dom.modal.hidden = true;
}
