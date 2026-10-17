/* Laser Maze — game orchestration: level lifecycle, input, hints, praise, progress.
 * Screens: title → map → game. Game loop drives the renderer.
 */
(function (root) {
  'use strict';

  const Engine = root.LaserEngine;
  const Levels = root.LaserLevels;
  const R = root.LaserRender;
  const UI = root.LaserUI;
  const S = root.LaserStorage;
  const sfx = root.LaserAudio.sfx;

  const canvas = document.getElementById('board');
  R.init(canvas);

  const G = {
    level: null, state: [], initial: [],
    moves: 0, hints: 0, solved: false,
    undo: [], par: null, prevLit: new Set(),
  };

  const parCache = new Map(); // level id -> par

  function computePar(level, initial) {
    if (parCache.has(level.id)) return parCache.get(level.id);
    const res = Engine.solve(level, initial);
    const par = res.par;
    parCache.set(level.id, par);
    return par;
  }

  // ---- level lifecycle ----------------------------------------------------

  function loadLevel(id) {
    const def = Levels.LEVELS.find((l) => l.id === id);
    if (!def || !S.isUnlocked(id)) { sfx.locked(); return; }

    G.level = Engine.buildLevel(def);
    G.initial = G.level.rotPieces.map((r) => G.level.pieces[r.idx].orient);
    G.state = G.initial.slice();
    G.moves = 0; G.hints = 0; G.solved = false;
    G.undo = [];
    G.prevLit = new Set();
    G.par = computePar(G.level, G.initial);

    R.setLevel(G.level, G.state);
    R.snapAngles(G.state);
    retrace(false);
    UI.hideWin();
    UI.showScreen('screen-game');
    R.resize(); // canvas was hidden on page load; sizes correctly now
    UI.updateHUD(G.level, G.moves, G.par);
    if (G.level.note) UI.toast(G.level.note, 3200);
  }

  function reloadLevel() { if (G.level) loadLevel(G.level.id); }

  function retrace(anim = true) {
    const trace = Engine.trace(G.level, G.state);
    // sound for targets gained/lost (renderer handles particle bursts)
    for (const tIdx of trace.lit) {
      if (!G.prevLit.has(tIdx) && anim) sfx.targetLit(tIdx % 8);
    }
    for (const tIdx of G.prevLit) {
      if (!trace.lit.has(tIdx) && anim) sfx.targetLost();
    }
    G.prevLit = new Set(trace.lit);

    R.refresh(trace);
    G.solved = trace.win;
    if (trace.win && anim) onWin();
    return trace;
  }

  // ---- moves ---------------------------------------------------------------

  function tapPiece(runIdx, { isHint = false } = {}) {
    if (G.solved) return;
    const level = G.level;
    if (!level || runIdx < 0 || runIdx >= level.rotPieces.length) return;

    G.undo.push({ runIdx, prev: G.state[runIdx] });
    const mod = level.rotPieces[runIdx].mod;
    G.state[runIdx] = (G.state[runIdx] + 1) % mod;
    if (!isHint) G.moves++;

    R.rotateVisual(runIdx, G.state[runIdx]);
    sfx.rotate(G.state[runIdx]);
    retrace();
    UI.updateHUD(level, G.moves, G.par);
  }

  function undo() {
    if (G.solved) return;
    const u = G.undo.pop();
    if (!u) { sfx.locked(); return; }
    G.state[u.runIdx] = u.prev;
    G.moves = Math.max(0, G.moves - 1);
    R.snapAngles(G.state);
    sfx.undo();
    retrace(false);
    UI.updateHUD(G.level, G.moves, G.par);
  }

  function reset() {
    if (!G.level || G.solved) return;
    G.state = G.initial.slice();
    G.undo = []; G.moves = 0; G.hints = 0;
    R.snapAngles(G.state);
    G.prevLit = new Set();
    sfx.reset();
    retrace(false);
    UI.updateHUD(G.level, G.moves, G.par);
    UI.toast('Board reset.', 1400);
  }

  function hint() {
    if (!G.level || G.solved) return;
    const step = Engine.hintStep(G.level, G.state);
    if (!step) { UI.toast('The board is already lit!', 1800); return; }
    G.hints++;
    sfx.hint();
    UI.toast('Hint applied — watch the flash.', 1800);
    setTimeout(() => tapPiece(step.runIdx, { isHint: true }), 120);
  }

  // ---- win -----------------------------------------------------------------

  function onWin() {
    const id = G.level.id;
    // streak = consecutive no-hint solves; it never depends on move counts
    const clean = G.hints === 0;
    S.completeLevel(id, G.moves, { clean });

    const isLast = id === 50;
    const isFinale = id % 10 === 0;
    if (isLast) { sfx.complete(); R.celebrateGameComplete(); }
    else if (isFinale) { sfx.finale(); R.celebrateFinale(); }
    else { sfx.win(); R.celebrateWin(); }

    const chapter = !isLast && id % 10 === 0 ? Math.ceil(id / 10) : null;

    setTimeout(() => {
      UI.showWin({
        levelId: id,
        isLast, isFinale, streak: S.streak(), chapter,
      });
    }, 250);
    UI.refreshTitle();
  }

  // ---- loop ----------------------------------------------------------------

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (G.level && document.getElementById('screen-game').classList.contains('active')) {
      R.syncSize(); // pick up show/hide + window resizes
      R.update(dt);
      R.draw();
    }
    requestAnimationFrame(frame);
  }

  // ---- wiring --------------------------------------------------------------

  function bind() {
    // first gesture unlocks WebAudio
    window.addEventListener('pointerdown', () => root.LaserAudio.resume(), { once: true });

    canvas.addEventListener('click', (e) => {
      if (!G.level || G.solved) return;
      const rect = canvas.getBoundingClientRect();
      const runIdx = R.hitTest(e.clientX - rect.left, e.clientY - rect.top);
      tapPiece(runIdx);
    });

    // hover feedback: pointer cursor + highlight ring on touchable pieces
    canvas.addEventListener('mousemove', (e) => {
      if (!G.level) return;
      if (G.solved) { R.setHover(-1); canvas.style.cursor = ''; return; }
      const rect = canvas.getBoundingClientRect();
      const ri = R.hitTest(e.clientX - rect.left, e.clientY - rect.top);
      R.setHover(ri);
      canvas.style.cursor = ri >= 0 ? 'pointer' : '';
    });
    canvas.addEventListener('mouseleave', () => {
      R.setHover(-1);
      canvas.style.cursor = '';
    });

    document.getElementById('btn-play').addEventListener('click', () => {
      sfx.ui();
      UI.buildMap(loadLevel);
      UI.showScreen('screen-map');
    });

    document.getElementById('btn-map-back').addEventListener('click', () => {
      sfx.ui(); UI.refreshTitle(); UI.showScreen('screen-title');
    });

    document.getElementById('btn-dock').addEventListener('click', () => {
      sfx.ui(); UI.toggleDock();
    });

    document.getElementById('btn-set-back').addEventListener('click', () => {
      sfx.ui(); UI.hideDock(); UI.refreshTitle();
    });

    document.getElementById('btn-exit').addEventListener('click', () => {
      sfx.ui(); UI.buildMap(loadLevel); UI.showScreen('screen-map');
    });

    document.getElementById('btn-undo').addEventListener('click', undo);
    document.getElementById('btn-reset').addEventListener('click', reset);
    document.getElementById('btn-hint').addEventListener('click', hint);

    document.getElementById('btn-win-map').addEventListener('click', () => {
      sfx.ui(); UI.hideWin(); UI.buildMap(loadLevel); UI.showScreen('screen-map');
    });
    document.getElementById('btn-win-replay').addEventListener('click', () => {
      sfx.ui(); UI.hideWin(); reloadLevel();
    });
    document.getElementById('btn-win-next').addEventListener('click', () => {
      sfx.ui(); UI.hideWin(); loadLevel(Math.min(G.level.id + 1, 50));
    });

    const applyMute = () => { root.LaserAudio.setMuted(S.data.muted); UI.setSoundLabel(S.data.muted); };
    document.getElementById('btn-sound').addEventListener('click', () => {
      S.setMuted(!S.data.muted); applyMute(); sfx.ui();
    });
    applyMute();

    document.getElementById('btn-wipe').addEventListener('click', () => {
      if (confirm('Erase all progress and streaks?')) {
        S.reset();
        UI.refreshTitle();
        UI.toast('Progress cleared.', 1600);
      }
    });

    // keyboard
    window.addEventListener('keydown', (e) => {
      if (!document.getElementById('screen-game').classList.contains('active')) return;
      if (e.key === 'u' || e.key === 'U' || e.key === 'z' || e.key === 'Z') undo();
      else if (e.key === 'r' || e.key === 'R') reset();
      else if (e.key === 'h' || e.key === 'H') hint();
      else if (e.key === 'Escape') document.getElementById('btn-exit').click();
    });

    window.addEventListener('resize', () => R.resize());

    UI.refreshTitle();
    applyMute();
    requestAnimationFrame(frame);
  }

  bind();

  // debug/QA hook (also handy from the browser console)
  root.LaserGame = {
    loadLevel,
    tapPiece,
    undo,
    reset,
    hint,
    get info() {
      return {
        id: G.level ? G.level.id : null, moves: G.moves, hints: G.hints,
        solved: G.solved, par: G.par, state: G.state.slice(),
      };
    },
  };
})(typeof self !== 'undefined' ? self : this);
