/* Laser Maze — DOM UI: screens, level map, HUD, overlays, toasts. */
(function (root) {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const UI = {};

  UI.showScreen = function (id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
    UI.hideDock(); // settings dock never survives a screen change
  };

  UI.toggleDock = function () {
    $('#settings-dock').classList.toggle('hidden');
  };

  UI.hideDock = function () {
    $('#settings-dock').classList.add('hidden');
  };

  let toastTimer = null;
  UI.toast = function (msg, ms = 2800) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
  };

  UI.buildMap = function (onSelect) {
    const grid = $('#level-grid');
    grid.innerHTML = '';
    const S = root.LaserStorage;
    for (let id = 1; id <= 50; id++) {
      const unlocked = S.isUnlocked(id);
      const cleared = !!S.bestFor(id);
      const btn = document.createElement('button');
      btn.className = 'node' + (unlocked ? '' : ' locked') + (cleared ? ' done' : '');
      btn.innerHTML = `<span class="num">${id}</span><span class="st">${unlocked ? (cleared ? '✓' : '·') : '🔒'}</span>`;
      btn.style.setProperty('--i', id - 1);
      if (unlocked) btn.addEventListener('click', () => { LaserAudio.sfx.ui(); onSelect(id); });
      else btn.addEventListener('click', () => LaserAudio.sfx.locked());
      grid.appendChild(btn);
    }
    $('#map-progress').textContent = `${S.clearedCount()}/50 cleared · 🔥 best streak ${S.bestStreak()}`;
  };

  // Title line: a challenge quote instead of level statistics — the quote
  // sharpens as more boards fall.
  const CHALLENGES = [
    [0,  '“Every maze hides a path of light. Dare to find your first.”'],
    [3,  '“A warm start — the prisms are already scheming.”'],
    [10, '“Sharp instincts so far. The maze is just waking up.”'],
    [20, '“Deep in the maze now. Splitters reward a daring hand.”'],
    [30, '“The boards are watching. Show them mastery.”'],
    [40, '“The full spectrum beckons the truly fearless.”'],
    [46, '“One final ascent. Master the light itself.”'],
  ];
  UI.refreshTitle = function () {
    const S = root.LaserStorage;
    const cleared = S.clearedCount();
    let quote = CHALLENGES[0][1];
    for (const [need, text] of CHALLENGES) if (cleared >= need) quote = text;
    $('#title-progress').textContent = quote;
  };

  UI.updateHUD = function (level) {
    $('#hud-level').textContent = `Level ${level.id} / 50`;
  };

  // Win-card copy: short and unique. The pool rotates round-robin (persisted
  // across sessions), so consecutive clears never repeat the same line, and no
  // message depends on move counts.
  const PRAISE = [
    'Brilliant — the light obeys.',
    'Every colour found its way.',
    'A flawless braid of beams.',
    'The maze bends to you.',
    'Radiant routing.',
    'Pure laser artistry.',
    'All lights sing in harmony.',
    'You bend light like a master.',
    'The board glows brighter already.',
    'Spectacular spectrum!',
    'Prisms surrender to your logic.',
    'One spark of genius after another.',
  ];
  const FACES = ['🌟', '✨', '💫', '⚡', '🎯', '🌈'];

  UI.showWin = function ({ levelId, isLast, isFinale, streak, chapter }) {
    const ov = $('#win-overlay');
    const slot = $('#win-cheer');
    const card = $('#win-card');

    slot.className = 'win-cheer';
    card.className = 'win-card' + (isLast ? ' complete' : isFinale ? ' finale' : '');
    const i = root.LaserStorage.nextMessage(PRAISE.length);
    slot.style.animationDelay = '0.1s';

    $('#win-title').textContent = isLast ? 'GAME COMPLETE!' : 'LEVEL CLEAR!';
    slot.textContent = FACES[i % FACES.length];

    let detail = PRAISE[i];
    if (!isLast && streak >= 2) detail += `  ·  🔥 ${streak} in a row`;
    $('#win-detail').textContent = detail;
    $('#btn-win-next').style.display = isLast ? 'none' : '';
    ov.classList.remove('hidden');
  };

  UI.hideWin = function () { $('#win-overlay').classList.add('hidden'); };

  UI.setSoundLabel = function (muted) {
    $('#btn-sound').textContent = muted ? '🔇 Sound off' : '🔊 Sound on';
  };

  root.LaserUI = UI;
})(typeof self !== 'undefined' ? self : this);
