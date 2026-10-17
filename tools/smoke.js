/* Headless smoke test: stub the browser DOM, load every game script,
 * then simulate full playthroughs of all 50 levels using the engine solver.
 * Run: node tools\smoke.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ---- browser stubs ---------------------------------------------------------

const listeners = new Map(); // element -> {event: [fns]}
function makeEl(id, extra = {}) {
  const el = {
    id,
    textContent: '',
    innerHTML: '',
    style: {},
    clientWidth: 800,
    clientHeight: 600,
    classList: {
      _set: new Set(['active']),
      toggle(c, on) { on ? this._set.add(c) : this._set.delete(c); },
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      contains(c) { return this._set.has(c); },
    },
    addEventListener(ev, fn) {
      if (!listeners.has(el)) listeners.set(el, {});
      const m = listeners.get(el);
      (m[ev] = m[ev] || []).push(fn);
    },
    appendChild() {},
    getContext: () => ctxProxy,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    ...extra,
  };
  return el;
}

const gradient = { addColorStop() {} };
const ctxProxy = new Proxy({}, {
  get(_t, prop) {
    if (prop === 'canvas') return canvasEl;
    return () => (prop.endsWith('Gradient') ? gradient : undefined);
  },
  set() { return true; },
});

const canvasEl = makeEl('board');

const els = {
  board: canvasEl,
  'btn-play': makeEl('btn-play'),
  'btn-map-back': makeEl('btn-map-back'),
  'btn-exit': makeEl('btn-exit'),
  'btn-undo': makeEl('btn-undo'),
  'btn-reset': makeEl('btn-reset'),
  'btn-hint': makeEl('btn-hint'),
  'btn-sound': makeEl('btn-sound'),
  'btn-dock': makeEl('btn-dock'),
  'btn-set-back': makeEl('btn-set-back'),
  'btn-wipe': makeEl('btn-wipe'),
  'btn-win-map': makeEl('btn-win-map'),
  'btn-win-replay': makeEl('btn-win-replay'),
  'btn-win-next': makeEl('btn-win-next'),
  'win-overlay': makeEl('win-overlay'),
  'win-cheer': makeEl('win-cheer'),
  'win-title': makeEl('win-title'),
  'win-detail': makeEl('win-detail'),
  'hud-level': makeEl('hud-level'),
  'hud-note': makeEl('hud-note'),
  'title-progress': makeEl('title-progress'),
  'map-progress': makeEl('map-progress'),
  'level-grid': makeEl('level-grid'),
  toast: makeEl('toast'),
};

const store = {};
const sandbox = {
  console,
  performance,
  setTimeout: (fn) => fn(), // fire async bits immediately in tests
  clearTimeout() {},
  requestAnimationFrame: () => 0, // don't spin the render loop in tests
  devicePixelRatio: 1,
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  },
  confirm: () => true,
  addEventListener() {},
  document: {
    getElementById: (id) => els[id] || makeEl(id),
    querySelector: (sel) => (sel === '#toast' ? els.toast : els[sel.replace(/^#/, '')]) || makeEl(sel),
    querySelectorAll: () => [],
    createElement: () => makeEl('dyn'),
  },
  Math, JSON, Date, Set, Map, Int16Array,
};
sandbox.self = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);

// ---- load game scripts in order --------------------------------------------

const files = ['engine.js', 'levels.js', 'storage.js', 'audio.js', 'render.js', 'ui.js', 'main.js'];
for (const f of files) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
  vm.runInContext(src, sandbox, { filename: f });
}

const { LaserEngine: E, LaserLevels: LV, LaserStorage: S, LaserGame: G } = sandbox;

const elText = (id) => els[id] ? els[id].textContent : '';

// ---- simulate playthroughs --------------------------------------------------

let failures = 0;
function check(cond, msg) {
  if (!cond) { failures++; console.error('  ✗ ' + msg); }
}

console.log('Smoke: full playthrough of all 50 levels (solver-guided taps)\n');
for (const def of LV.LEVELS) {
  G.loadLevel(def.id);
  const before = G.info;
  check(before.par != null && before.par > 0, `L${def.id} par should be > 0 (got ${before.par})`);

  let steps = 0;
  while (!G.info.solved && steps < 30) {
    const step = E.hintStep(E.buildLevel(def), G.info.state);
    if (!step) break;
    G.tapPiece(step.runIdx);
    steps++;
  }
  const after = G.info;
  check(after.solved, `L${def.id} should reach win via solver path`);
  check(after.moves === after.par, `L${def.id} moves (${after.moves}) should equal par (${after.par})`);
  check(S.bestFor(def.id) != null, `L${def.id} should record best moves`);
  check(S.isUnlocked(def.id + 1) || def.id === 50, `L${def.id} should unlock next level`);
  process.stdout.write(`  L${String(def.id).padStart(2)} solved in ${after.moves} (par ${after.par}) streak ${S.streak()}\n`);
}

// ---- undo / reset behaviour --------------------------------------------------

console.log('\nSmoke: undo & reset on level 10');
G.loadLevel(10);
const initState = G.info.state.slice();
const step = E.hintStep(E.buildLevel(LV.LEVELS.find(l => l.id === 10)), G.info.state);
G.tapPiece(step.runIdx);
check(G.info.moves === 1, 'moves should be 1 after tap');
G.undo();
check(G.info.moves === 0, 'undo should decrement moves to 0');
check(JSON.stringify(G.info.state) === JSON.stringify(initState), 'undo should restore initial state');
G.tapPiece(step.runIdx);
G.reset();
check(G.info.moves === 0 && JSON.stringify(G.info.state) === JSON.stringify(initState), 'reset should restore start');

// ---- render loop exercise -----------------------------------------------------

console.log('\nSmoke: renderer update/draw frames');
const Rr = sandbox.LaserRender;
G.loadLevel(17); // has prisms
for (let i = 0; i < 5; i++) { Rr.update(1 / 60); Rr.draw(); }
G.tapPiece(0);
for (let i = 0; i < 5; i++) { Rr.update(1 / 60); Rr.draw(); }
G.loadLevel(45); // 10x10
for (let i = 0; i < 3; i++) { Rr.update(1 / 60); Rr.draw(); }
Rr.resize();
check(true, 'render frames completed without throwing');

function dispatch(ev_name, el, x, y) {
  const hs = listeners.get(el) || {};
  const ev = { clientX: x, clientY: y };
  (hs[ev_name] || []).forEach((fn) => fn(ev));
}

// ---- click coordinates regression: hidden canvas at load ----------------------

console.log('\nSmoke: mirror turns when clicked after screen becomes visible');
// simulate page load with the game screen hidden (zero-size canvas, never sized)
canvasEl.clientWidth = 0; canvasEl.clientHeight = 0;
Rr.W = 0; Rr.H = 0;
G.loadLevel(1);
check(Rr.W === 0 && Rr.ox <= 0, 'layout stays stale while hidden');
// game screen becomes visible → frame loop should sync size
canvasEl.clientWidth = 1100; canvasEl.clientHeight = 750;
Rr.syncSize(); Rr.draw();
check(Rr.W === 1100 && Rr.cell > 0, 'renderer resized after screen shown');
const lv1 = E.buildLevel(LV.LEVELS.find(l => l.id === 1));
const rotPc = lv1.pieces[lv1.rotPieces[0].idx];
const px = Rr.ox + (rotPc.x + 0.5) * Rr.cell;
const py = Rr.oy + (rotPc.y + 0.5) * Rr.cell;
const stateBefore = JSON.stringify(G.info.state);
dispatch('mousemove', els.board, px, py);
dispatch('click', els.board, px, py);
check(G.info.moves === 1, 'click on the mirror should register a move');
check(JSON.stringify(G.info.state) !== stateBefore, 'state should change after the click');
// simulate a window resize mid-game — clicks must still land correctly
canvasEl.clientWidth = 640; canvasEl.clientHeight = 700;
Rr.syncSize(); Rr.draw();
G.reset();
const px2 = Rr.ox + (rotPc.x + 0.5) * Rr.cell;
const py2 = Rr.oy + (rotPc.y + 0.5) * Rr.cell;
dispatch('click', els.board, px2, py2);
check(G.info.moves === 1, 'click still lands after resize');

// ---- storage sanity ----------------------------------------------------------

check(S.maxLevel() === 50, 'all levels unlocked after playthrough');
// 50 solver clears + 1 from the click-regression block (its single tap solves L1)
check(S.streak() >= 50, `clean-solve streak should be ≥ 50 (got ${S.streak()})`);
check(S.bestStreak() >= 50, `best streak should be ≥ 50 (got ${S.bestStreak()})`);

// ---- no-hint streak rules -----------------------------------------------------

console.log('\nSmoke: streak is no-hint based, messages rotate');
G.loadLevel(2);
// spin the first rotatable through a full cycle: state unchanged, moves wasted
const n0 = G.info.state.length;
G.tapPiece(0); G.tapPiece(0);
check(G.info.moves === 2, `full-cycle taps should waste 2 moves (got ${G.info.moves})`);
// now finish with the solver
let guard = 0;
while (!G.info.solved && guard++ < 8) {
  const s2 = E.hintStep(E.buildLevel(LV.LEVELS.find(l => l.id === 2)), G.info.state);
  if (!s2) break;
  G.tapPiece(s2.runIdx);
}
check(G.info.solved, 'spoiled solve should still finish');
check(G.info.moves === G.info.par + 2, `spoiled solve should move par+2 times (${G.info.moves} vs par+2 = ${G.info.par + 2})`);
check(S.streak() >= 50, `an inefficient but hint-free solve keeps the streak (${S.streak()})`);
check(S.bestFor(2) === G.info.par, 'best moves for level 2 should stay at par');

// a hint breaks the streak
const beforeHint = S.streak();
G.loadLevel(3);
G.hint();          // applies one solver step as a hint
guard = 0;
while (!G.info.solved && guard++ < 12) {
  const s3 = E.hintStep(E.buildLevel(LV.LEVELS.find(l => l.id === 3)), G.info.state);
  if (!s3) break;
  G.tapPiece(s3.runIdx);
}
check(G.info.solved, 'hinted level should still finish');
check(S.streak() === 0, `streak should reset after a hinted solve (was ${beforeHint}, now ${S.streak()})`);

// win messages rotate without immediate repeats
const details = new Set();
for (let i = 0; i < 4; i++) {
  G.loadLevel(i + 4);
  const sN = E.hintStep(E.buildLevel(LV.LEVELS.find(l => l.id === i + 4)), G.info.state);
  G.tapPiece(sN.runIdx);
  if (!G.info.solved) {
    let g2 = 0;
    while (!G.info.solved && g2++ < 20) {
      const sn2 = E.hintStep(E.buildLevel(LV.LEVELS.find(l => l.id === i + 4)), G.info.state);
      if (!sn2) break;
      G.tapPiece(sn2.runIdx);
    }
  }
  details.add(elText('win-detail'));
}
check(details.size === 4, `consecutive win messages should differ (${[...details].join(' | ')})`);

console.log(failures === 0 ? '\nALL SMOKE TESTS PASSED ✔' : `\n${failures} SMOKE FAILURES ✗`);
process.exit(failures === 0 ? 0 : 1);
