/* Strip the mini-chains that tools/colour.js appended — reverses a colour.js
 * run so chains can be regenerated with better placement rules.
 *
 * Appended chains are contiguous token runs appended at the end of each
 * level's objects line, in the same order as the report below. Each run is
 * exactly [E(color), M, T(color)] (1-mirror chains) or [E(color), T(color)]
 * (straight chains). A candidate run is additionally verified geometrically
 * (the emitter's beam must bend at the mirror and land exactly on the target
 * over empty cells), and the stripped level itself is re-measured before the
 * file is accepted — never corrupts a level.
 *
 * Usage: node tools/strip.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Engine = require('../js/engine.js');

const LEVELS_PATH = path.join(__dirname, '..', 'js', 'levels.js');

// exactly what colour.js appended, level by level, in append order
const APPENDED = {
  11: ['green 3'], 12: ['blue 3'], 13: ['cyan 3'], 14: ['purple 3'],
  15: ['red 3'], 16: ['orange 3'], 17: ['yellow 3'], 18: ['magenta 3'],
  19: ['orange 2'], 20: ['blue 3'],
  21: ['red 3', 'blue 3'], 22: ['green 3'], 23: ['yellow 3'], 24: ['blue 3'],
  25: ['green 3'], 26: ['red 3', 'yellow 3'], 27: ['green 3', 'blue 2'],
  28: ['red 3', 'cyan 2'], 29: ['purple 3'], 30: ['green 3', 'blue 3'],
  31: ['red 3', 'green 1', 'blue 1'], 32: ['green 3', 'purple 2'],
  33: ['purple 3'], 34: ['orange 1'], 35: ['yellow 2'], 36: ['purple 2'],
  37: ['blue 3', 'orange 0'], 38: ['magenta 3'],
  39: ['red 0', 'green 1', 'cyan 1'], 40: ['yellow 2'],
  41: ['yellow 3', 'orange 2'], 42: ['green 3', 'yellow 1', 'magenta 1'],
  43: ['red 0', 'orange 1', 'purple 0'], 44: ['yellow 2', 'cyan 1'],
  45: ['red 2', 'green 1', 'blue 1', 'yellow 1'],
  46: ['red 1', 'green 1', 'blue 1', 'purple 0'],
  47: ['yellow 2', 'purple 2'], 48: ['cyan 2', 'orange 2'],
  49: ['yellow 2', 'purple 2'], 50: ['cyan 2', 'orange 1'],
};

const DIRS = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const PERP = { N: ['E', 'W'], E: ['N', 'S'], S: ['E', 'W'], W: ['N', 'S'] };

function parseArgs(s) {
  return s.split(',').map(a => a.trim().replace(/'/g, ''));
}

/** build a def {t:'emitter'...} list from factory-call text */
function evalDef(id, inner, size) {
  const objects = [];
  const re = /(E|T|M|P|FX|WALL|S|Z)\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(inner)) !== null) {
    const a = parseArgs(m[2]);
    switch (m[1]) {
      case 'E': objects.push({ t: 'emitter', x: +a[0], y: +a[1], dir: a[2], color: a[3] }); break;
      case 'T': objects.push({ t: 'target', x: +a[0], y: +a[1], color: a[2] }); break;
      case 'M': objects.push({ t: 'mirror', x: +a[0], y: +a[1], orient: +a[2] }); break;
      case 'P': objects.push({ t: 'prism', x: +a[0], y: +a[1], orient: +a[2] }); break;
      case 'FX': objects.push({ t: 'fixed', x: +a[0], y: +a[1], orient: +a[2] }); break;
      case 'WALL': objects.push({ t: 'wall', x: +a[0], y: +a[1] }); break;
      case 'S': objects.push({ t: 'splitter', x: +a[0], y: +a[1], orient: +a[2] }); break;
      case 'Z': objects.push({ t: 'filter', x: +a[0], y: +a[1], color: a[2] }); break;
    }
  }
  const wh = size ? size : (id >= 21 ? [9, 9] : [8, 8]);
  return { id, objects, w: wh[0], h: wh[1] };
}

function measureOK(def) {
  const level = Engine.buildLevel(def);
  const mods = level.rotPieces.map(r => r.mod);
  let total = mods.reduce((a, b) => a * b, 1);
  if (total > 65536) return false;
  for (let n = 0; n < total; n++) {
    const s = []; let t = n;
    for (let i = 0; i < mods.length; i++) { s.push(t % mods[i]); t = (t - s[i]) / mods[i]; }
    if (Engine.trace(level, s).win) return true;
  }
  return false;
}

/** E fires `dir`; the beam must reach each mirror going straight from the
 * previous point, bend 90° at each mirror, and land exactly on the target
 * over empty cells (the chain's own pieces and the target are allowed landings). */
function verifyRoute(def, e, mToks, t) {
  const occupied = new Set(def.objects.map(o => `${o.x},${o.y}`));
  const w = def.w, h = def.h;
  const inB = (x, y) => x >= 0 && y >= 0 && x < w && y < h;

  const landOn = (x, y, want) => x === want.x && y === want.y;
  const walkTo = (sx, sy, dir, want) => {   // returns true if `want` is the first piece hit
    let x = sx + DIRS[dir][0], y = sy + DIRS[dir][1];
    while (inB(x, y)) {
      if (landOn(x, y, want)) return true;
      if (occupied.has(`${x},${y}`)) return false;
      x += DIRS[dir][0]; y += DIRS[dir][1];
    }
    return false;
  };

  const bend = (ii, from, dir) => {
    if (ii === mToks.length) return walkTo(from.x, from.y, dir, t);
    const m = mToks[ii];
    if (!walkTo(from.x, from.y, dir, m)) return false;
    for (const out of PERP[dir]) {
      if (bend(ii + 1, m, out)) return true;
    }
    return false;
  };
  return bend(0, e, e.dir);
}

const report = [];

function stripLevel(rawText, id, chainsSpec) {
  const lines = rawText.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/id:\s*(\d+),/);
    if (m && +m[1] === id) { start = i; break; }
  }
  if (start < 0) throw new Error(`L${id} not found`);
  let objectsLine = -1;
  for (let i = start; i < lines.length; i++) {
    if (/objects:\s*\[/.test(lines[i])) { objectsLine = i; break; }
  }
  const orig = lines[objectsLine];
  const text0 = orig.match(/objects:\s*\[(.*)\]/)[1];
  let text = text0;
  // find an explicit size: [w,h] line inside the level block (also used later)
  let size = null;
  for (let i = start; i < Math.min(objectsLine + 4, lines.length); i++) {
    const ms = lines[i].match(/size:\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/);
    if (ms) { size = [+ms[1], +ms[2]]; break; }
  }

  // strip in reverse append order so each removed run sits at the end
  for (const spec of chainsSpec.slice().reverse()) {
    const [color, mStr] = spec.split(' ');
    const wantM = +mStr;
    const mPat = wantM
      ? `\\s*,\\s*${Array(wantM).fill("M\\(\\s*\\d+,\\s*\\d+,\\s*\\d+\\)").join('\\s*,\\s*')}`
      : '';
    const runRe = new RegExp(
      `E\\(\\s*\\d+,\\s*\\d+,\\s*'(?:N|E|S|W)',\\s*'${color}'\\)${mPat}\\s*,\\s*T\\(\\s*\\d+,\\s*\\d+,\\s*'${color}'\\)`,
      'g');
    let best = null, m;
    while ((m = runRe.exec(text)) !== null) best = m; // prefer the last match
    if (!best) throw new Error(`L${id} chain ${color}(${wantM}) not found`);
    // geometric verification against the full original def
    const vDef = evalDef(id, text0, size);
    const reTok = /(E|T|M)\(([^)]*)\)/g;
    const runs = [...best[0].matchAll(reTok)];
    const factory = (name, argStr) => {
      const a = parseArgs(argStr);
      if (name === 'E') return { t: 'emitter', x: +a[0], y: +a[1], dir: a[2], color: a[3] };
      if (name === 'T') return { t: 'target', x: +a[0], y: +a[1], color: a[2] };
      return { t: 'mirror', x: +a[0], y: +a[1], orient: +a[2] };
    };
    const e = factory('E', runs[0][2]);
    const tT = factory('T', runs[runs.length - 1][2]);
    const mToks = [];
    for (let i = 1; i + 1 < runs.length; i++) mToks.push(factory('M', runs[i][2]));
    if (!verifyRoute(vDef, e, mToks, tT)) {
      throw new Error(`L${id} chain ${color}(${wantM}) failed geometry check`);
    }
    // remove run; if a comma follows it, eat that instead (keeps spacing tidy)
    let s = best.index, eIdx = best.index + best[0].length;
    if (/^\s*,/.test(text.slice(eIdx))) {
      eIdx = eIdx + text.slice(eIdx).length - text.slice(eIdx).replace(/^\s*,\s*/, '').length;
    } else if (/[,\s]+$/.test(text.slice(0, s))) {
      s = s - (text.slice(0, s).length - text.slice(0, s).replace(/[,\s]+$/, '').length);
    }
    text = text.slice(0, s) + text.slice(eIdx);
  }

  const rebuilt = `      objects: [ ${text.trim()} ],`;
  // preserve any explicit size in the rebuilt block it lives next to (spawn line untouched)
  const checkDef = evalDef(id, rebuilt.match(/objects:\s*\[(.*)\]/)[1], size);
  if (!measureOK(checkDef)) {
    report.push(`L${id} STRIP REJECTED (would become unsolvable)`);
    return rawText;
  }
  return rawText.replace(orig, rebuilt);
}

let raw = fs.readFileSync(LEVELS_PATH, 'utf8');
for (const [id, spec] of Object.entries(APPENDED)) {
  const before = raw;
  try {
    raw = stripLevel(raw, +id, spec);
    report.push(`L${id} ${raw === before ? 'UNCHANGED' : 'stripped'}`);
  } catch (err) {
    report.push(`L${id} ERROR: ${err.message}`);
    throw err;
  }
}
fs.writeFileSync(LEVELS_PATH, raw);
console.log(report.join('\n'));
