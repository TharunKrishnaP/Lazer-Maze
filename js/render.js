/* Laser Maze — canvas renderer: deep-space nebulae, twinkling starfield,
 * glowing neon grid, luminous beams, animated mirrors, particles.
 * All drawing is procedural; no image assets.
 */
(function (root) {
  'use strict';

  const LV = root.LaserLevels;
  const COLOR_HEX = LV.COLOR_HEX;

  // single theme throughout the game
  const THEME = {
    bg: ['#05070f', '#0a0f26'],
    grid: 'rgba(110,150,255,0.10)',
    accent: '#5ad1ff',
    star: 'rgba(255,255,255,0.35)',
    nebulae: [
      { col: 'rgba(45,90,200,0.14)', r: 0.62, ax: 0.28, ay: 0.22, sx: 0.9, sy: 1.3, period: 37 },
      { col: 'rgba(120,40,170,0.12)', r: 0.5, ax: 0.78, ay: 0.7, sx: 1.4, sy: 1.1, period: 29 },
      { col: 'rgba(20,140,150,0.10)', r: 0.45, ax: 0.45, ay: 0.85, sx: 1.15, sy: 0.95, period: 23 },
    ],
  };

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(hex, a) {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  }

  const R = {
    canvas: null, ctx: null, dpr: 1, W: 0, H: 0,
    level: null, state: [], segments: [], lit: new Set(),
    cell: 60, ox: 0, oy: 0,
    angles: [],       // current visual angle (rad) per rotatable piece
    angleGoals: [],   // target visual angle; eased toward in update()
    particles: [],
    time: 0,
    pulse: [],        // lit-target pulse start timestamps (by piece index)
    hover: -1,        // rotatable piece index under the cursor, -1 = none
    ripples: [],      // tap feedback: expanding rings at tapped pieces
    fireworks: [],    // scheduled celebration bursts {at, x, y, color}
    fxFlash: null,    // full-board celebration flash {age, life}
  };

  R.init = function (canvas) {
    R.canvas = canvas;
    R.ctx = canvas.getContext('2d');
    R.resize();
  };

  R.resize = function () {
    if (!R.canvas) return;
    const dpr = Math.min(2, root.devicePixelRatio || 1);
    R.dpr = dpr;
    const w = R.canvas.clientWidth, h = R.canvas.clientHeight;
    if (!w || !h) return; // hidden element — will re-sync when visible
    R.canvas.width = Math.round(w * dpr);
    R.canvas.height = Math.round(h * dpr);
    R.W = w; R.H = h;
    if (R.level) R.layout();
  };

  // cheap each-frame check: re-layout when the canvas CSS size changes
  // (catches the game screen becoming visible, window resizes, etc.)
  R.syncSize = function () {
    if (!R.canvas) return;
    const w = R.canvas.clientWidth, h = R.canvas.clientHeight;
    if (w && h && (w !== R.W || h !== R.H)) R.resize();
  };

  R.setHover = function (runIdx) { R.hover = runIdx; };

  R.setLevel = function (level, state) {
    R.level = level;
    R.state = state.slice();
    R.angles = level.rotPieces.map((r, i) => angleFor(level.pieces[r.idx].type, state[i]));
    R.angleGoals = R.angles.slice();
    R.pulse = [];
    R.prevLit = new Set();
    R.particles = [];
    R.hover = -1;
    R.fireworks = [];
    R.fxFlash = null;
    R.layout();
  };

  R.layout = function () {
    const lv = R.level;
    if (!lv) return;
    const pad = 24;
    R.cell = Math.max(28, Math.min(Math.floor((R.W - pad * 2) / lv.w), Math.floor((R.H - pad * 2) / lv.h)));
    R.ox = Math.floor((R.W - R.cell * lv.w) / 2);
    R.oy = Math.floor((R.H - R.cell * lv.h) / 2);
  };

  R.c2p = (x) => R.ox + (x + 0.5) * R.cell;   // cell center x
  R.c2q = (y) => R.oy + (y + 0.5) * R.cell;   // cell center y

  function angleFor(type, orient) {
    // '/' = -45°, '\' = +45°, '|' = 90°, '—' = 0°
    if (type === 'prism') return [-0.125, 0.25, 0.125, 0][orient] * Math.PI * 2;
    return (orient === 0 ? -0.125 : 0.125) * Math.PI * 2;
  }

  // Begin animating a rotatable piece toward its new orientation (always forward spin).
  R.rotateVisual = function (runIdx, newOrient) {
    const lv = R.level;
    const piece = lv.pieces[lv.rotPieces[runIdx].idx];
    const from = R.angles[runIdx] ?? angleFor(piece.type, newOrient);
    const canonical = angleFor(piece.type, newOrient);
    // line shapes look identical mod 180°, so mirrors/splitters spin in 90° steps;
    // prisms have 4 distinct states, spin through canonical angles in 360° periods.
    const period = piece.type === 'prism' ? Math.PI * 2 : Math.PI;
    let to = canonical;
    while (to <= from + 1e-4) to += period;
    R.angleGoals[runIdx] = to;
    playSparkAt(piece.x, piece.y);
    R.ripples.push({ x: piece.x, y: piece.y, age: 0, life: 0.45 });
    return to;
  };

  // keep visual angles aligned with logical state after undo/reset/hint-jump
  R.snapAngles = function (state) {
    R.state = state.slice();
    R.level.rotPieces.forEach((r, i) => {
      R.angles[i] = angleFor(R.level.pieces[r.idx].type, state[i]);
      R.angleGoals[i] = R.angles[i];
    });
  };

  function playSparkAt(x, y) {
    const px = R.c2p(x), py = R.c2q(y);
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      R.particles.push({
        x: px, y: py, vx: Math.cos(a) * 60, vy: Math.sin(a) * 60,
        life: 0.4, age: 0, color: '#9fd0ff', size: 2 + Math.random() * 2,
      });
    }
  }

  R.celebrateTarget = function (piece, color) {
    const px = R.c2p(piece.x), py = R.c2q(piece.y);
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 120;
      R.particles.push({
        x: px, y: py, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
        life: 0.7 + Math.random() * 0.5, age: 0, color: COLOR_HEX[color], size: 1.5 + Math.random() * 2.5,
      });
    }
  };

  // full-board celebration: lights bloom from every lit target with a burst of
  // colour confetti — fired by the game logic on a win
  R.celebrateWin = function () {    const lv = R.level;
    if (!lv) return;
    const palette = Object.keys(COLOR_HEX);
    for (const p of lv.pieces) {
      if (p.type !== 'target') continue;
      const pir = lv.grid[p.y * lv.w + p.x];
      if (!R.lit.has(pir)) continue;
      const px = R.c2p(p.x), py = R.c2q(p.y);
      R.ripples.push({ x: p.x, y: p.y, age: 0, life: 0.8, col: COLOR_HEX[p.color], strong: true });
      for (let i = 0; i < 26; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 60 + Math.random() * 190;
        R.particles.push({
          x: px, y: py, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 70,
          life: 0.9 + Math.random() * 0.8, age: 0,
          color: palette[Math.floor(Math.random() * palette.length)],
          size: 1.5 + Math.random() * 3,
        });
      }
    }
  };

  function burstAt(x, y, color, count = 36, sp0 = 70, sp1 = 240) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = sp0 + Math.random() * Math.random() * sp1;
      R.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 1 + Math.random() * 0.9, age: 0,
        color: Math.random() < 0.2 ? '#ffffff' : color,
        size: 1.5 + Math.random() * 3,
      });
    }
    R.ripples.push({ x, y, age: 0, life: 0.8, col: color, strong: true });
  }

  // set finale (L10/20/30/40): rainbow shockwaves from the board centre plus
  // a bloom on every target and a bright screen flash
  R.celebrateFinale = function () {
    const lv = R.level;
    if (!lv) return;
    const palette = Object.keys(COLOR_HEX);
    const cx = (lv.w - 1) / 2, cy = (lv.h - 1) / 2;
    for (let i = 0; i < palette.length; i++) {
      R.ripples.push({ x: cx, y: cy, age: -i * 0.12, life: 1.1, col: COLOR_HEX[palette[i]], strong: true });
    }
    for (const p of lv.pieces) {
      if (p.type !== 'target') continue;
      const col = COLOR_HEX[p.color];
      burstAt(R.c2p(p.x), R.c2q(p.y), col, 16, 50, 160);
    }
    R.fxFlash = { age: 0, life: 0.7, peak: 0.55 };
  };

  // game complete (L50): a staggered full-spectrum firework show across the
  // board, ending in a centre mega-burst and flash
  R.celebrateGameComplete = function () {
    const lv = R.level;
    if (!lv) return;
    const palette = Object.keys(COLOR_HEX);
    for (let i = 0; i < 14; i++) {
      R.fireworks.push({
        at: R.time + 0.2 + i * 0.17,
        x: R.ox + (0.15 + Math.random() * 0.7) * lv.w * R.cell,
        y: R.oy + (0.1 + Math.random() * 0.65) * lv.h * R.cell,
        color: COLOR_HEX[palette[i % palette.length]],
      });
    }
    // finale burst at the end of the show
    R.fireworks.push({
      at: R.time + 2.6,
      x: R.c2p((lv.w - 1) / 2), y: R.c2q((lv.h - 1) / 2),
      color: '#ffffff', mega: true,
    });
    R.fxFlash = { age: 0, life: 1.2, peak: 0.7 };
  };

  R.update = function (dt) {
    R.time += dt;
    // ease mirror angles toward their goals (rotation tween)
    for (let i = 0; i < R.angles.length; i++) {
      const goal = R.angleGoals[i];
      if (goal === undefined) continue;
      const diff = goal - R.angles[i];
      if (Math.abs(diff) < 0.02) R.angles[i] = goal;
      else R.angles[i] += diff * Math.min(1, dt * 22);
    }
    // particle physics
    for (const p of R.particles) {
      p.age += dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += 160 * dt;
    }
    R.particles = R.particles.filter(p => p.age < p.life);
    for (const rp of R.ripples) rp.age += dt;
    R.ripples = R.ripples.filter(rp => rp.age < rp.life);
    // fire scheduled fireworks
    while (R.fireworks.length && R.fireworks[0].at <= R.time) {
      const fw = R.fireworks.shift();
      burstAt(fw.x, fw.y, fw.color, fw.mega ? 90 : 34, fw.mega ? 120 : 70, fw.mega ? 320 : 240);
      if (fw.mega) R.fxFlash = { age: 0, life: 0.9, peak: 0.8 };
    }
    if (R.fxFlash) { R.fxFlash.age += dt; if (R.fxFlash.age >= R.fxFlash.life) R.fxFlash = null; }
  };

  // ---- drawing ------------------------------------------------------------

  function drawSpace(c) {
    const th = THEME;
    // base gradient
    const g = c.createLinearGradient(0, 0, 0, R.H);
    g.addColorStop(0, th.bg[0]);
    g.addColorStop(1, th.bg[1]);
    c.fillStyle = g;
    c.fillRect(0, 0, R.W, R.H);

    // drifting nebula blooms
    c.globalCompositeOperation = 'lighter';
    for (const n of th.nebulae) {
      const t = (R.time / n.period) % 2;
      const wob = Math.sin(t * Math.PI);          // 0→1→0 glide
      const bx = (n.ax + (wob - 0.5) * 0.18 * n.sx) * R.W;
      const by = (n.ay + (Math.sin(t * Math.PI + 1.2) - 0.5) * 0.15 * n.sy) * R.H;
      const rad = n.r * Math.max(R.W, R.H) * (0.95 + 0.12 * wob);
      const ng = c.createRadialGradient(bx, by, 0, bx, by, rad);
      ng.addColorStop(0, n.col);
      ng.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = ng;
      c.fillRect(0, 0, R.W, R.H);
    }
    c.globalCompositeOperation = 'source-over';

    // two-depth twinkling starfield with slow drift
    for (let i = 0; i < 130; i++) {
      const layer = i < 84 ? 0 : 1;               // far, near
      const speed = layer === 0 ? 0.004 : 0.012;
      const sx = (((i * 97) % 1000) / 1000 + R.time * speed * (layer + 0.4)) % 1;
      const sy = (((i * 131) % 1000) / 1000 + layer * 0.37) % 1;
      const si = i * 89 + layer * 13;
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(R.time * (layer ? 1.1 : 0.6) + si % 6));
      c.globalAlpha = (layer ? 0.62 : 0.38) * tw;
      c.fillStyle = layer ? '#dfe9ff' : '#ffffff';
      const sz = layer ? 2.1 : 1.4;
      c.fillRect(sx * R.W, sy * R.H, sz, sz);
    }
    c.globalAlpha = 1;

    // soft vignette keeps the centre bright and edges cinematic
    const vg = c.createRadialGradient(R.W / 2, R.H / 2, Math.min(R.W, R.H) * 0.42, R.W / 2, R.H / 2, Math.max(R.W, R.H) * 0.78);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.5)');
    c.fillStyle = vg;
    c.fillRect(0, 0, R.W, R.H);
  }

  R.draw = function () {
    const c = R.ctx, lv = R.level;
    if (!c) return;
    const th = THEME;
    c.save();
    c.scale(R.dpr, R.dpr);

    drawSpace(c);

    if (!lv) { c.restore(); return; }

    const u = scale(); // stroke scale, piece art scales with cell size
    drawBoard(c, lv, th, u);

    // beams under pieces (pieces stay solid on top)
    drawBeams(c, u);

    for (const p of lv.pieces) drawPiece(c, p, u);

    // particles
    for (const p of R.particles) {
      const a = 1 - p.age / p.life;
      c.globalAlpha = Math.max(0, a);
      c.shadowColor = p.color;
      c.shadowBlur = 8;
      c.fillStyle = p.color;
      c.beginPath();
      c.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      c.fill();
      c.shadowBlur = 0;
    }
    c.globalAlpha = 1;

    // tap ripples — expanding rings where pieces were just rotated
    for (const rp of R.ripples) {
      if (rp.age < 0) continue; // staggered celebration waves tick in later
      const k = rp.age / rp.life;
      c.globalAlpha = (1 - k) * (rp.strong ? 0.9 : 0.65);
      c.strokeStyle = rp.col || '#9fd4ff';
      c.lineWidth = (rp.strong ? 2.5 : 1) + 2.5 * u * (1 - k);
      c.beginPath();
      c.arc(R.c2p(rp.x), R.c2q(rp.y), R.cell * (0.55 + k * (rp.strong ? 1.5 : 0.9)), 0, Math.PI * 2);
      c.stroke();
    }
    c.globalAlpha = 1;

    // celebration flash — soft full-board light bloom that fades
    if (R.fxFlash) {
      const k = R.fxFlash.age / R.fxFlash.life;
      const a0 = Math.pow(Math.max(0, 1 - k), 1.6) * (R.fxFlash.peak || 0.5);
      c.globalCompositeOperation = 'lighter';
      const fg = c.createRadialGradient(R.ox + lv.w * R.cell / 2, R.oy + lv.h * R.cell / 2, 0, R.ox + lv.w * R.cell / 2, R.oy + lv.h * R.cell / 2, Math.max(lv.w, lv.h) * R.cell * 1.1);
      fg.addColorStop(0, `rgba(190,225,255,${a0})`);
      fg.addColorStop(1, 'rgba(190,225,255,0)');
      c.fillStyle = fg;
      c.fillRect(0, 0, R.W, R.H);
      c.globalCompositeOperation = 'source-over';
    }
    c.restore();
  };

  function scale() {
    return Math.min(2, Math.max(0.55, R.cell / 56));
  }

  function drawBoard(c, lv, th, u) {
    const bx = R.ox - 12, by = R.oy - 12;
    const bw = lv.w * R.cell + 24, bh = lv.h * R.cell + 24;

    // outer aura glow
    c.save();
    c.shadowColor = rgba(th.accent, 0.55);
    c.shadowBlur = 34 * u;
    roundRect(c, bx, by, bw, bh, 16);
    c.lineWidth = 2.5;
    c.strokeStyle = rgba(th.accent, 0.5);
    c.stroke();
    c.restore();

    // deep board body with a faint centre bloom
    roundRect(c, bx, by, bw, bh, 16);
    c.fillStyle = 'rgba(7,10,24,0.72)';
    c.fill();
    const bg = c.createRadialGradient(R.ox + bw / 2, R.oy + bh / 2, 0, R.ox + bw / 2, R.oy + bh / 2, bw * 0.6);
    bg.addColorStop(0, 'rgba(70,120,255,0.10)');
    bg.addColorStop(1, 'rgba(70,120,255,0)');
    c.fillStyle = bg;
    roundRect(c, bx, by, bw, bh, 16);
    c.fill();

    // inner frame hairline
    c.strokeStyle = 'rgba(160,200,255,0.16)';
    c.lineWidth = 1;
    roundRect(c, bx + 3.5, by + 3.5, bw - 7, bh - 7, 13);
    c.stroke();

    // grid lines
    c.strokeStyle = th.grid;
    c.lineWidth = 1;
    c.beginPath();
    for (let x = 0; x <= lv.w; x++) { c.moveTo(R.ox + x * R.cell + 0.5, R.oy); c.lineTo(R.ox + x * R.cell + 0.5, R.oy + lv.h * R.cell); }
    for (let y = 0; y <= lv.h; y++) { c.moveTo(R.ox, R.oy + y * R.cell + 0.5); c.lineTo(R.ox + lv.w * R.cell, R.oy + y * R.cell + 0.5); }
    c.stroke();

    // intersection ticks — precise "lab bench" feel
    c.strokeStyle = 'rgba(120,170,255,0.28)';
    c.lineWidth = 1;
    c.beginPath();
    const tk = Math.max(3, 3.5 * u), gap = Math.max(4, 5 * u);
    for (let x = 0; x <= lv.w; x++) {
      for (let y = 0; y <= lv.h; y++) {
        const px = R.ox + x * R.cell, py = R.oy + y * R.cell;
        c.moveTo(px - tk, py); c.lineTo(px - gap, py);
        c.moveTo(px + gap, py); c.lineTo(px + tk, py);
        c.moveTo(px, py - tk); c.lineTo(px, py - gap);
        c.moveTo(px, py + gap); c.lineTo(px, py + tk);
      }
    }
    c.stroke();

    // corner accents
    c.strokeStyle = rgba(th.accent, 0.85);
    c.lineWidth = 2.4 * u;
    c.lineCap = 'round';
    const cs = 15, cn = 7;
    for (const [cxx, cyy, dx, dy] of [[bx, by, 1, 1], [bx + bw, by, -1, 1], [bx, by + bh, 1, -1], [bx + bw, by + bh, -1, -1]]) {
      c.beginPath();
      c.moveTo(cxx + dx * cs, cyy); c.lineTo(cxx + dx * cn, cyy); c.lineTo(cxx + dx * cn, cyy + dy * cn); c.lineTo(cxx, cyy + dy * cn);
      c.stroke();
    }
  }

  function drawBeams(c, u) {
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.lineCap = 'round';
    for (const s of R.segments) {
      const col = COLOR_HEX[s.color] || '#ff3b5c';
      const x1 = R.ox + s.x1 * R.cell + R.cell / 2;
      const y1 = R.oy + s.y1 * R.cell + R.cell / 2;
      const x2 = R.ox + s.x2 * R.cell + R.cell / 2;
      const y2 = R.oy + s.y2 * R.cell + R.cell / 2;

      // breathing halo → body → white-hot core (bright neon glow)
      const breathe = 1 + 0.1 * Math.sin(R.time * 2.4 + (x1 + y1) * 0.05);
      c.strokeStyle = rgba(col, 0.26); c.lineWidth = 15 * u * breathe;
      c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
      c.strokeStyle = rgba(col, 0.8); c.lineWidth = 4.8 * u;
      c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
      c.strokeStyle = rgba('#ffffff', 1); c.lineWidth = 1.7 * u;
      c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();

      // flowing photon comet packets with a short fading tail
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const n = Math.max(1, Math.min(6, Math.floor(len / 30)));
      for (let i = 0; i < n; i++) {
        const k = ((i / n) + (R.time * 0.8)) % 1;
        const px = x1 + dx * k, py = y1 + dy * k;
        for (let tail = 0; tail < 3; tail++) {
          const tk = (k - tail * 0.035 + 1) % 1;
          const tx = x1 + dx * tk, ty = y1 + dy * tk;
          c.fillStyle = rgba(col, tail === 0 ? 0.9 : 0.3 / tail);
          c.beginPath(); c.arc(tx, ty, (tail === 0 ? 2.6 : 2) * u, 0, Math.PI * 2); c.fill();
        }
      }

      // impact spark where a beam dies at a wall / board edge
      // (those endpoints are always at half-cell positions)
      if (!isCellCenter(s.x2) || !isCellCenter(s.y2)) {
        c.fillStyle = rgba(col, 0.55);
        c.beginPath(); c.arc(x2, y2, 5.5 * u, 0, Math.PI * 2); c.fill();
        c.fillStyle = rgba('#ffffff', 0.85);
        c.beginPath(); c.arc(x2, y2, 2 * u, 0, Math.PI * 2); c.fill();
      }
    }
    c.restore();
  }

  function isCellCenter(v) { return Math.abs(v - Math.round(v)) < 0.25; }

  function drawPiece(c, p, u) {
    const lv = R.level;
    const cx = R.c2p(p.x), cy = R.c2q(p.y);
    const half = R.cell * 0.5;

    const pir = lv.grid[p.y * lv.w + p.x];
    const ri = lv.rotPieces.findIndex(r => r.idx === pir);
    const isRot = p.type === 'mirror' || p.type === 'prism' || p.type === 'splitter';
    const hovered = isRot && ri >= 0 && R.hover === ri;
    let orient = p.orient;
    if (isRot && ri >= 0) orient = R.state[ri];

    switch (p.type) {
      case 'wall': {
        const s = half * 0.96;
        c.fillStyle = '#232a40';
        roundRect(c, cx - s, cy - s, s * 2, s * 2, 5 * u);
        c.fill();
        c.strokeStyle = 'rgba(195,208,235,0.45)';
        c.lineWidth = 1.6 * u;
        c.stroke();
        // machined cross-notch
        c.strokeStyle = 'rgba(10,13,24,0.9)';
        c.lineWidth = 2.6 * u;
        const n = s * 0.4;
        c.beginPath();
        c.moveTo(cx - n, cy - n); c.lineTo(cx + n, cy + n);
        c.moveTo(cx + n, cy - n); c.lineTo(cx - n, cy + n);
        c.stroke();
        break;
      }
      case 'emitter': {
        const col = COLOR_HEX[p.color] || '#ff3b5c';
        const rot = [-Math.PI / 2, 0, Math.PI / 2, Math.PI][p.dir]; // N,E,S,W
        // aura behind the chassis
        const aura = c.createRadialGradient(cx, cy, 2, cx, cy, half * 1.9);
        aura.addColorStop(0, rgba(col, 0.4));
        aura.addColorStop(1, rgba(col, 0));
        c.fillStyle = aura;
        c.beginPath(); c.arc(cx, cy, half * 1.9, 0, Math.PI * 2); c.fill();
        c.save();
        c.translate(cx, cy);
        c.rotate(rot);
        const s = half * 0.9;
        // chassis
        c.fillStyle = 'rgba(22,28,46,0.97)';
        c.strokeStyle = rgba(col, 0.95);
        c.lineWidth = 2.2 * u;
        roundRect(c, -s, -s, s * 2, s * 2, 8 * u);
        c.fill(); c.stroke();
        // barrel
        c.fillStyle = 'rgba(38,48,74,1)';
        roundRect(c, s * 0.25, -s * 0.32, s * 0.9, s * 0.64, 3 * u);
        c.fill();
        c.strokeStyle = rgba(col, 0.6);
        c.lineWidth = 1.2 * u;
        c.stroke();
        // hot aperture with slight flicker
        const flick = 0.85 + 0.15 * Math.sin(R.time * 9 + p.x * 3);
        c.fillStyle = rgba(col, 0.95 * flick);
        c.beginPath(); c.arc(s * 1.18, 0, s * 0.2, 0, Math.PI * 2); c.fill();
        // lens core
        const g2 = c.createRadialGradient(0, 0, 1, 0, 0, s * 0.52);
        g2.addColorStop(0, rgba('#ffffff', 0.95));
        g2.addColorStop(0.45, rgba(col, 0.9));
        g2.addColorStop(1, rgba(col, 0.08));
        c.fillStyle = g2;
        c.beginPath(); c.arc(0, 0, s * 0.52, 0, Math.PI * 2); c.fill();
        c.restore();
        break;
      }
      case 'target': {
        const col = COLOR_HEX[p.color] || '#ff3b5c';
        const lit = R.lit.has(pir);
        const r = half * 0.72;
        const pulse = lit ? 0.5 + 0.5 * Math.sin(R.time * 4.5) : 0;
        c.save();
        c.translate(cx, cy);
        // soft halo while lit
        if (lit) {
          const halo = c.createRadialGradient(0, 0, r * 0.4, 0, 0, r * 2.4);
          halo.addColorStop(0, rgba(col, 0.65 + 0.25 * pulse));
          halo.addColorStop(1, rgba(col, 0));
          c.fillStyle = halo;
          c.beginPath(); c.arc(0, 0, r * 2.4, 0, Math.PI * 2); c.fill();
        } else {
          // unlit: slowly rotating dashed scan ring — "waiting for signal"
          c.rotate(R.time * 0.6);
          c.strokeStyle = rgba(col, 0.5);
          c.lineWidth = 1.6 * u;
          c.setLineDash([4 * u, 5 * u]);
          c.beginPath(); c.arc(0, 0, r * 1.45, 0, Math.PI * 2); c.stroke();
          c.setLineDash([]);
          c.rotate(-R.time * 0.6);
        }
        // dish
        c.fillStyle = 'rgba(12,16,28,0.96)';
        c.strokeStyle = rgba(col, lit ? 1 : 0.85);
        c.lineWidth = 2.6 * u;
        c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill(); c.stroke();
        // inner ring keeps the color readable even when unlit
        c.strokeStyle = rgba(col, lit ? 0.9 : 0.38);
        c.lineWidth = 1.3 * u;
        c.beginPath(); c.arc(0, 0, r * 0.7, 0, Math.PI * 2); c.stroke();
        // color-coded core
        c.fillStyle = rgba(col, lit ? 1 : 0.35);
        c.beginPath(); c.arc(0, 0, r * (lit ? 0.4 + 0.08 * pulse : 0.22), 0, Math.PI * 2); c.fill();
        if (lit) {
          c.fillStyle = rgba('#ffffff', 0.95);
          c.beginPath(); c.arc(0, 0, r * 0.16, 0, Math.PI * 2); c.fill();
        }
        // activation burst ring
        const start = R.pulse[pir];
        const burst = start !== undefined ? Math.max(0, 1 - (R.time - start) / 0.5) : 0;
        if (burst > 0) {
          c.strokeStyle = rgba(col, burst);
          c.lineWidth = 3.5 * u * burst;
          c.beginPath(); c.arc(0, 0, r * (1 + (1 - burst) * 1.1), 0, Math.PI * 2); c.stroke();
        }
        c.restore();
        break;
      }
      case 'mirror': case 'fixed': case 'splitter': case 'prism': {
        const angle = isRot && ri >= 0 ? R.angles[ri] : angleFor(p.type, orient);
        if (isRot) {
          // interaction pad — tells the player this piece is touchable
          const pr = half * 0.95;
          c.fillStyle = 'rgba(120,200,255,0.06)';
          c.beginPath(); c.arc(cx, cy, pr, 0, Math.PI * 2); c.fill();
          if (hovered) {
            // cursor pad animates a spinning dash ring — tactile invitation
            c.rotate(R.time * 1.4);
            c.strokeStyle = rgba('#9fd4ff', 0.9);
            c.lineWidth = 2 * u;
            c.setLineDash([6 * u, 7 * u]);
            c.beginPath(); c.arc(cx, cy, pr, 0, Math.PI * 2); c.stroke();
            c.setLineDash([]);
            c.rotate(-R.time * 1.4);
          } else {
            c.strokeStyle = rgba('#9fd4ff', 0.22);
            c.lineWidth = 1.3 * u;
            c.beginPath(); c.arc(cx, cy, pr, 0, Math.PI * 2); c.stroke();
          }
        }
        drawMirrorBar(c, cx, cy, half, angle, p.type, u, hovered);
        if (p.type === 'fixed') {
          // corner brackets = frozen
          const s = half * 0.99, k = half * 0.3;
          c.strokeStyle = 'rgba(150,170,210,0.55)';
          c.lineWidth = 1.6 * u;
          c.beginPath();
          for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
            const x0 = cx + sx * s, y0 = cy + sy * s;
            c.moveTo(x0 - sx * k, y0); c.lineTo(x0, y0); c.lineTo(x0, y0 - sy * k);
          }
          c.stroke();
        }
        break;
      }
      case 'filter': {
        const col = COLOR_HEX[p.color] || '#38b6ff';
        const s = half * 0.8;
        c.fillStyle = rgba(col, 0.2);
        c.strokeStyle = rgba(col, 0.9);
        c.lineWidth = 2 * u;
        roundRect(c, cx - s, cy - s, s * 2, s * 2, 7 * u);
        c.fill(); c.stroke();
        // diamond marks "pass-through"
        c.strokeStyle = rgba('#ffffff', 0.75);
        c.lineWidth = 1.6 * u;
        const d = s * 0.42;
        c.beginPath();
        c.moveTo(cx, cy - d); c.lineTo(cx + d, cy); c.lineTo(cx, cy + d); c.lineTo(cx - d, cy);
        c.closePath(); c.stroke();
        break;
      }
    }
  }

  function drawMirrorBar(c, cx, cy, half, angle, type, u, hovered) {
    c.save();
    c.translate(cx, cy);
    if (hovered) { // pieces under the cursor swell a touch — tactile feedback
      c.scale(1.12, 1.12);
    }
    const L = half * 1.02;
    const accents = { mirror: '#e8f0ff', fixed: '#9fb2d8', splitter: '#ffd76b', prism: '#7fe9ff' };
    const accent = accents[type] || '#e8f0ff';

    if (type === 'prism') {
      // static diamond body; only the state bar rotates inside it
      c.beginPath();
      c.moveTo(0, -L); c.lineTo(L, 0); c.lineTo(0, L); c.lineTo(-L, 0);
      c.closePath();
      c.fillStyle = 'rgba(36,52,82,0.97)';
      c.fill();
      c.shadowColor = accent;
      c.shadowBlur = 10 * u;
      c.strokeStyle = accent; c.lineWidth = 2 * u; c.stroke();
      c.shadowBlur = 0;
      c.rotate(angle);
      c.strokeStyle = rgba('#7fe9ff', 0.95);
      c.lineWidth = 4.2 * u; c.lineCap = 'round';
      c.beginPath(); c.moveTo(-L * 0.6, 0); c.lineTo(L * 0.6, 0); c.stroke();
      c.fillStyle = '#0b1122';
      c.beginPath(); c.arc(0, 0, 3 * u, 0, Math.PI * 2); c.fill();
    } else {
      c.rotate(angle);
      const bw = (type === 'splitter' ? 12 : 9) * u;
      // dark backing
      c.strokeStyle = 'rgba(18,24,42,0.97)';
      c.lineWidth = bw + 4 * u;
      c.lineCap = 'round';
      c.beginPath(); c.moveTo(-L, 0); c.lineTo(L, 0); c.stroke();
      // reflective face
      c.shadowColor = accent;
      c.shadowBlur = 12 * u;
      c.strokeStyle = accent;
      c.lineWidth = bw;
      c.beginPath(); c.moveTo(-L, 0); c.lineTo(L, 0); c.stroke();
      c.shadowBlur = 0;
      // moving highlight sweep along the bar
      const sweep = ((R.time * 0.9) % 2) * 1.6 - 0.3;  // sweeps -0.3 .. 1.3
      const gL = bw / 2;
      c.strokeStyle = rgba('#ffffff', 0.8);
      c.lineWidth = 1.4 * u;
      c.beginPath();
      c.moveTo(Math.max(-L, Math.min(L, sweep * L)), -gL * 0.5);
      c.lineTo(Math.max(-L, Math.min(L, sweep * L + 0.35)), gL * 0.5);
      c.stroke();
      // pivot axle — makes the rotation point obvious
      c.fillStyle = 'rgba(14,18,32,1)';
      c.beginPath(); c.arc(0, 0, 3.4 * u, 0, Math.PI * 2); c.fill();
      c.strokeStyle = rgba(accent, 0.9);
      c.lineWidth = 1.2 * u;
      c.beginPath(); c.arc(0, 0, 3.4 * u, 0, Math.PI * 2); c.stroke();
      if (type === 'splitter') {
        // dashed twin = transmits AND reflects
        c.strokeStyle = rgba('#ffd76b', 0.85);
        c.lineWidth = 1.8 * u;
        c.setLineDash([4 * u, 5 * u]);
        c.lineCap = 'butt';
        const oy2 = bw / 2 + 3.5 * u;
        c.beginPath(); c.moveTo(-L * 0.88, oy2); c.lineTo(L * 0.88, oy2); c.stroke();
        c.setLineDash([]);
      }
    }
    c.restore();
  }

  // trace refresh (called by game logic when state changes)
  R.refresh = function (trace) {
    R.segments = trace.segments;
    R.lit = trace.lit;
    for (const tIdx of trace.lit) {
      if (!R.pulse[tIdx]) {
        R.pulse[tIdx] = R.time;
        const p = R.level.pieces[tIdx];
        if (p) R.celebrateTarget(p, p.color);
      }
    }
    for (const tIdx of R.prevLit || []) if (!trace.lit.has(tIdx)) R.pulse[tIdx] = undefined;
    R.prevLit = trace.lit;
  };

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  // hit testing: returns runIdx of rotatable piece at pixel coords, or -1
  R.hitTest = function (mx, my) {
    const lv = R.level;
    if (!lv) return -1;
    const gx = Math.floor((mx - R.ox) / R.cell);
    const gy = Math.floor((my - R.oy) / R.cell);
    if (gx < 0 || gy < 0 || gx >= lv.w || gy >= lv.h) return -1;
    const idx = lv.grid[gy * lv.w + gx];
    if (idx < 0) return -1;
    return lv.rotPieces.findIndex(r => r.idx === idx);
  };

  R.setTheme = function () { /* single theme — kept as a no-op for compatibility */ };

  // debug/QA hook: flash a rotatable piece (used by hints)
  R.flashPiece = function (runIdx) {
    const lv = R.level;
    if (!lv) return;
    const p = lv.pieces[lv.rotPieces[runIdx].idx];
    playSparkAt(p.x, p.y);
    playSparkAt(p.x, p.y);
  };

  root.LaserRender = R;
})(typeof self !== 'undefined' ? self : this);
