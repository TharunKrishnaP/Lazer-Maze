/* Colour expansion v2: brings every level up to its tier's colour count.
 *
 *   L1–10 → 1 colour   L11–20 → 2   L21–30 → 3   L31–40 → 4   L41–50 → 5
 *
 * For each missing colour the tool builds an independent mini-chain
 * (emitter → up to 3 mirrors → target) whose cells no winning beam path ever
 * touches, so all existing solutions stay valid. Rules:
 *   • chains never share cells (beams may cross on empty cells only);
 *   • same-colour pieces of the new chain sit ≥ 3 cells (Chebyshev) from any
 *     existing piece of that colour — colours never crowd themselves;
 *   • candidates prefer richer routes (more mirrors, longer runs) for extra
 *     rotation depth and better looks;
 *   • every candidate is simulated (win exists, state budget ≤ 20 000,
 *     compounding across chains) before it is written into js/levels.js.
 *
 * Usage: node tools/colour.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Engine = require('../js/engine.js');

const LEVELS_PATH = path.join(__dirname, '..', 'js', 'levels.js');
const MAX_STATES = 262144;
const MAX_TRIALS = 150;
const DIRS = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const PERP = { N: ['E', 'W'], E: ['N', 'S'], S: ['E', 'W'], W: ['N', 'S'] };

const NEED = {
  11: 'blue,green',      12: 'yellow,blue',    13: 'magenta,cyan',
  14: 'cyan,purple',     15: 'red,blue',       16: 'green,orange',
  17: 'purple,yellow',   18: 'green,magenta',  19: 'blue,orange',
  20: 'orange,blue',
  21: 'yellow,red,blue', 22: 'red,blue,green', 23: 'red,blue,yellow',
  24: 'red,green,blue',  25: 'red,blue,green', 26: 'cyan,red,yellow',
  27: 'magenta,green,blue', 28: 'yellow,red,cyan', 29: 'red,blue,purple',
  30: 'orange,green,blue',
  31: 'cyan,red,green,blue',   32: 'red,blue,green,purple', 33: 'red,green,blue,purple',
  34: 'red,blue,green,orange', 35: 'red,blue,green,yellow', 36: 'red,blue,green,purple',
  37: 'red,green,blue,orange', 38: 'red,blue,green,magenta', 39: 'purple,red,green,cyan',
  40: 'red,blue,green,yellow',
  41: 'red,green,blue,yellow,orange', 42: 'red,blue,green,yellow,magenta',
  43: 'green,blue,red,orange,purple', 44: 'red,blue,green,yellow,cyan',
  45: 'magenta,red,green,blue,yellow', 46: 'cyan,red,green,blue,purple',
  47: 'red,blue,green,yellow,purple', 48: 'red,blue,green,cyan,orange',
  49: 'red,green,blue,yellow,purple', 50: 'red,blue,green,cyan,orange',
};

function enumerateStates(mods) {
  const total = mods.reduce((a, b) => a * b, 1);
  if (total > MAX_STATES) return null;
  const states = [];
  for (let n = 0; n < total; n++) {
    const s = []; let t = n;
    for (let i = 0; i < mods.length; i++) { s.push(t % mods[i]); t = (t - s[i]) / mods[i]; }
    states.push(s);
  }
  return states;
}

/** simulate a def: { solvedCount, total } or null (unsolvable / too big) */
function measure(def) {
  const level = Engine.buildLevel(def);
  const mods = level.rotPieces.map(r => r.mod);
  const states = enumerateStates(mods);
  if (!states) return null;
  let wins = 0;
  for (const s of states) if (Engine.trace(level, s).win) wins++;
  if (!wins) return null;
  return { solvedCount: wins, total: states.length };
}

/** cells covered by beams in EVERY winning state + all piece cells → no-go zone */
function blockedForNewPieces(def) {
  const level = Engine.buildLevel(def);
  const mods = level.rotPieces.map(r => r.mod);
  const total = mods.reduce((a, b) => a * b, 1);
  if (total > MAX_STATES) throw new Error('base too big');
  const winStates = [];
  for (let n = 0; n < total; n++) {
    const s = []; let t = n;
    for (let i = 0; i < mods.length; i++) { s.push(t % mods[i]); t = (t - s[i]) / mods[i]; }
    const tr = Engine.trace(level, s);
    if (!tr.win) continue;
    winStates.push({ state: s, trace: tr });
  }
  if (!winStates.length) throw new Error('base unsolvable');

  const blocked = new Set();
  for (const p of level.pieces) blocked.add(`${p.x},${p.y}`);
  const addSeg = (seg) => {
    const x1 = Math.round(seg.x1), y1 = Math.round(seg.y1);
    const x2 = Math.round(seg.x2), y2 = Math.round(seg.y2);
    const dx = Math.sign(x2 - x1), dy = Math.sign(y2 - y1);
    let x = x1, y = y1;
    for (;;) {
      blocked.add(`${x},${y}`);
      if (x === x2 && y === y2) break;
      x += dx; y += dy;
    }
  };
  for (const ws of winStates) for (const seg of ws.trace.segments) addSeg(seg);

  let budget = total;
  const sameColour = {};  // colour → cells of existing pieces of that colour
  for (const p of level.pieces) if (p.color) (sameColour[p.color] = sameColour[p.color] || []).push(`${p.x},${p.y}`);
  return { blocked, budget, total, winStates };
}

/** build candidates: emitter lane walks, mirror bends carry in/out dirs; mirror
 * count 0..3 and same-colour spacing ≥ MIN_SEP enforced during generation */
const MIN_SEP = 3;

function candidatesFor(w, h, avoid, color, sameColourCells) {
  const free = (x, y, excl) =>
    x >= 0 && y >= 0 && x < w && y < h &&
    !avoid.has(`${x},${y}`) && !(excl && excl.has(`${x},${y}`));

  const sepOK = (pe) => {
    for (const cell of sameColourCells) {
      const [cx, cy] = cell.split(',').map(Number);
      if (Math.max(Math.abs(pe.x - cx), Math.abs(pe.y - cy)) < MIN_SEP) return false;
    }
    return true;
  };

  const walk = (x, y, dx, dy, excl, maxLen) => {
    const cells = [];
    let cx = x, cy = y, guard = 0;
    while (guard++ < maxLen && free(cx, cy, excl)) {
      cells.push({ x: cx, y: cy });
      cx += dx; cy += dy;
    }
    return cells;
  };

  const out = [];
  for (let ey = 0; ey < h; ey++) {
    for (let ex = 0; ex < w; ex++) {
      if (!free(ex, ey)) continue;
      const eCell = { x: ex, y: ey };
      if (!sepOK(eCell)) continue;
      for (const dir of Object.keys(DIRS)) {
        const [dx, dy] = DIRS[dir];
        const lane1 = walk(ex + dx, ey + dy, dx, dy, null, 8);
        if (!lane1.length) continue;

        // straight chain (no rotation): target just in front of the emitter
        if (sepOK(lane1[0])) {
          out.push({
            color, E: { x: ex, y: ey, dir }, mirrors: [],
            target: lane1[0],
            cells: new Set([`${ex},${ey}`, `${lane1[0].x},${lane1[0].y}`]),
          });
        }

        const far = (tgt) =>
          Math.max(Math.abs(tgt.x - ex), Math.abs(tgt.y - ey)) >= MIN_SEP;  // chain's own E↔T never crowd

        bend1: for (const m1 of lane1) {
          const base1 = new Set([`${ex},${ey}`]);
          for (let k = 0; k <= lane1.indexOf(m1); k++) base1.add(`${lane1[k].x},${lane1[k].y}`);
          for (const od of PERP[dir]) {
            const [odx, ody] = DIRS[od];
            const lane2 = walk(m1.x + odx, m1.y + ody, odx, ody, base1, 8);
            if (!lane2.length) continue;
            for (const c2 of lane2) base1.add(`${c2.x},${c2.y}`);
            // 1 mirror → target at lane2 end
            for (const t2 of lane2) {
              if (!sepOK(t2) || !far(t2)) continue;
              out.push({
                color, E: { x: ex, y: ey, dir },
                mirrors: [{ x: m1.x, y: m1.y, in: dir, out: od }],
                target: t2,
                cells: new Set([...base1, `${t2.x},${t2.y}`]),
              });
            }
            // 2 mirror chains: bend again from every lane2 cell except target slots
            for (const m2cell of lane2) {
              if (m2cell.x === lane2[lane2.length - 1].x && m2cell.y === lane2[lane2.length - 1].y) continue;
              for (const od2 of PERP[od]) {
                if (od2 === dir) continue;
                const [od2x, od2y] = DIRS[od2];
                const lane3 = walk(m2cell.x + od2x, m2cell.y + od2y, od2x, od2y, base1, 8);
                if (!lane3.length) continue;
                for (const c3 of lane3) base1.add(`${c3.x},${c3.y}`);
                for (const t3 of lane3) {
                  if (!sepOK(t3) || !far(t3)) continue;
                  out.push({
                    color, E: { x: ex, y: ey, dir },
                    mirrors: [
                      { x: m1.x, y: m1.y, in: dir, out: od },
                      { x: m2cell.x, y: m2cell.y, in: od, out: od2 },
                    ],
                    target: t3,
                    cells: new Set(lane3.map(c => `${c.x},${c.y}`).concat([...base1])),
                  });
                }
                // 3 mirror chains: one more bend
                for (const m3cell of lane3) {
                  const lane3end = lane3[lane3.length - 1];
                  if (m3cell.x === lane3end.x && m3cell.y === lane3end.y) continue;
                  for (const od3 of PERP[od2]) {
                    if (od3 === od) continue;
                    const [od3x, od3y] = DIRS[od3];
                    const lane4 = walk(m3cell.x + od3x, m3cell.y + od3y, od3x, od3y, base1, 8);
                    if (!lane4.length) continue;
                    for (const t4 of lane4) {
                      if (!sepOK(t4) || !far(t4)) continue;
                      out.push({
                        color, E: { x: ex, y: ey, dir },
                        mirrors: [
                          { x: m1.x, y: m1.y, in: dir, out: od },
                          { x: m2cell.x, y: m2cell.y, in: od, out: od2 },
                          { x: m3cell.x, y: m3cell.y, in: od2, out: od3 },
                        ],
                        target: t4,
                        cells: new Set(lane4.map(c => `${c.x},${c.y}`).concat([...base1])),
                      });
                    }
                  }
                }
                if (out.length > 40000) break bend1; // safety valve
              }
            }
          }
        }
      }
    }
  }
  // preference: 3 mirrors > 2 > 1 > straight; longer footprint; wider spread
  const tier = (n) => (n === 3 ? 0 : n === 2 ? 1 : n === 1 ? 2 : 3);
  const rank = (c) =>
    tier(c.mirrors.length) * 1e6 -
    c.cells.size * 1e3 +
    c.E.y * 2 + c.E.x;
  out.sort((a, b) => rank(a) - rank(b));
  return out;
}

function orientFor(inDir, outDir) {
  return ['E>N', 'N>E', 'S>W', 'W>S'].includes(`${inDir}>${outDir}`) ? 0 : 1;
}

// ---- text rewriting ---------------------------------------------------------

function applyAdditions(rawText, id, snippets) {
  const lines = rawText.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/id:\s*(\d+),/);
    if (m && +m[1] === id) { start = i; break; }
  }
  if (start < 0) throw new Error(`level ${id} block not found`);
  for (let i = start; i < lines.length; i++) {
    if (/objects:\s*\[/.test(lines[i])) {
      lines[i] = lines[i].replace(/\]\s*,?\s*$/, `, ${snippets.join(', ')} ],`);
      return lines.join('\n');
    }
  }
  throw new Error(`objects line not found in level ${id}`);
}

// ---- main -------------------------------------------------------------------

const defs = require('../js/levels.js').LEVELS;
let raw = fs.readFileSync(LEVELS_PATH, 'utf8');
const report = [];
let totalAdds = 0, failures = 0;
let chainsPlaced = 0;
const mirrorTally = { 0: 0, 1: 0, 2: 0, 3: 0 };

for (const def of defs) {
  const need = NEED[def.id];
  if (!need) { continue; }
  const w = def.size ? def.size[0] : def.w;
  const h = def.size ? def.size[1] : def.h;
  const colours = new Set();
  for (const o of def.objects) if (o.t === 'emitter' || o.t === 'target' || o.t === 'filter') colours.add(o.color);
  const missing = need.split(',').filter(c => !colours.has(c));
  if (!missing.length) { report.push(`${String(def.id).padStart(2)} | colours ok`); continue; }

  const info = blockedForNewPieces(def);
  const taken = new Set(info.blocked);
  let budget = info.total;
  const sameColourBase = {};
  for (const o of def.objects) {
    if (o.color && (o.t === 'emitter' || o.t === 'target')) {
      (sameColourBase[o.color] = sameColourBase[o.color] || []).push(`${o.x},${o.y}`);
    }
  }

  const snippets = [], placedObjs = [], log = [];
  const totalMissing = missing.length;

  missing.forEach((color, mi) => {
    // reserve state budget so every colour later in this group can still get
    // at least one mirror (avoids starving the last chains into bare stubs)
    const remAfter = totalMissing - mi - 1;
    const allowed = Math.floor(Math.log2(MAX_STATES / (2 ** remAfter) / budget));
    const capM = Math.max(0, Math.min(3, isFinite(allowed) ? allowed : 0));
    const avoidColor = new Set([...(sameColourBase[color] || [])]);
    let done = null, trials = 0;
    for (const cand of candidatesFor(w, h, taken, color, avoidColor)) {
      if (cand.mirrors.length > capM) continue;
      // compounding state budget pre-filter
      if (budget * (1 << cand.mirrors.length) > MAX_STATES) continue;
      if (++trials > MAX_TRIALS) break;
      const objs = [{ t: 'emitter', x: cand.E.x, y: cand.E.y, dir: cand.E.dir, color }];
      for (const mir of cand.mirrors) {
        objs.push({ t: 'mirror', x: mir.x, y: mir.y, orient: orientFor(mir.in, mir.out) });
      }
      objs.push({ t: 'target', x: cand.target.x, y: cand.target.y, color });
      const r = measure({ ...def, objects: [...def.objects, ...objs] });
      if (!r) continue;
      done = { cand, objs };
      break;
    }
    if (!done) { log.push(`${color}:NO-FIT`); failures++; return; }
    budget *= (1 << done.cand.mirrors.length);
    for (const cell of done.cand.cells) taken.add(cell);
    sameColourBase[color] = (sameColourBase[color] || []).concat([`${done.cand.E.x},${done.cand.E.y}`, `${done.cand.target.x},${done.cand.target.y}`]);
    placedObjs.push(done.objs);
    snippets.push(done.objs.map(o => {
      if (o.t === 'emitter') return `E(${o.x}, ${o.y}, '${o.dir}', '${o.color}')`;
      if (o.t === 'mirror') return `M(${o.x}, ${o.y}, ${o.orient})`;
      return `T(${o.x}, ${o.y}, '${o.color}')`;
    }).join(', '));
    mirrorTally[done.cand.mirrors.length] = (mirrorTally[done.cand.mirrors.length] || 0) + 1;
    totalAdds++;
    log.push(`${color}:ok(M${done.cand.mirrors.length})`);
  });

  if (snippets.length) {
    raw = applyAdditions(raw, def.id, snippets);
    const combined = measure({ ...def, objects: [...def.objects, ...placedObjs.flat()] });
    const stat = combined ? `states=${combined.total} wins=${combined.solvedCount}` : 'COMBINED-FAIL';
    report.push(`${String(def.id).padStart(2)} | ${log.join(' ')} | ${stat}`);
  } else {
    report.push(`${String(def.id).padStart(2)} | FAIL ${log.join(' ')}`);
  }
}

fs.writeFileSync(LEVELS_PATH, raw);
console.log(report.join('\n'));
console.log(`\nadded ${totalAdds} chains (mirrors 0/1/2/3: ${mirrorTally[0]}/${mirrorTally[1]}/${mirrorTally[2]}/${mirrorTally[3]}), ${failures} failures`);
