/* destub.js — eliminate "pre-solved" targets.
 *
 * A target whose feeding beam path contains no rotatable piece (mirror /
 * prism / splitter) is lit in EVERY rotation state — it is already solved the
 * moment the board appears, no matter which spawn design.js picks. This also
 * covers the old straight chain stubs (emitter fires straight into an
 * adjacent same-colour target), which additionally read as same-colour
 * pieces sitting on top of each other.
 *
 * For every such chain this tool re-anchors the shot as
 *     E → rotatable M → T
 * keeping the emitter, choosing a mirror cell and a bent target cell so that
 *   · the route runs over empty cells only,
 *   · E and T sit ≥3 apart (Chebyshev),
 *   · T sits ≥3 from every other same-colour piece,
 *   · the level gains 1 rotatable piece (state budget ≤ 200k) and stays
 *     solvable.
 * Later steps (declump.js, design.js) re-space and re-pin; the exact ramp par
 * is re-validated there. Usage: node tools/destub.js
 */
'use strict';
const fs = require('fs');
const Engine = require('../js/engine.js');
const LV = require('./lvlib.js');

const { DIRS, PERP } = LV;
const MAX_STATES = 262144;

// reflections achievable with a "/" mirror (orient 0); everything else is "\"
const SLASH = new Set(['E>N', 'N>E', 'S>W', 'W>S']);

const { lines, levels } = LV.loadLevels();
const report = [];
const touched = [];
let failures = 0;

for (const lvl of levels) {
  const spawn = LV.valueOfSpawn(lvl);
  const level0 = Engine.buildLevel(LV.makeDef(lvl, lvl.objects, spawn));
  const trace0 = Engine.trace(level0, spawn || level0.rotPieces.map(() => 0));

  // empirical always-lit detection: a target lit in EVERY rotation state is
  // pre-solved at every possible spawn. Transmission through splitters is
  // orientation-independent, so rotatable pieces on the path do NOT preclude
  // it — enumeration is the only reliable test.
  const mods0 = level0.rotPieces.map((r) => r.mod);
  const total0 = mods0.reduce((a, b) => a * b, 1);
  const always = new Set(trace0.lit);
  for (let n = 0; n < total0; n++) {
    const s = [];
    let t = n;
    for (let i = 0; i < mods0.length; i++) { s.push(t % mods0[i]); t = (t - s[i]) / mods0[i]; }
    const tr = Engine.trace(level0, s);
    for (const i of [...always]) {
      if (!tr.lit.has(i)) always.delete(i);
    }
    if (!always.size) break;
  }
  if (!always.size) continue; // nothing permanently pre-solved in this level

  // segment-end index for the backward walk
  const byEnd = new Map();
  trace0.segments.forEach((s, i) => {
    const k = `${s.x2},${s.y2}`;
    if (!byEnd.has(k)) byEnd.set(k, []);
    byEnd.get(k).push(i);
  });
  const cellsOf = (s) => {
    const cs = [];
    const dx = Math.sign(s.x2 - s.x1), dy = Math.sign(s.y2 - s.y1);
    let x = s.x1, y = s.y1;
    while (true) {
      cs.push([x, y]);
      if (x === s.x2 && y === s.y2) break;
      x += dx; y += dy;
    }
    return cs;
  };

  for (const tIdx of [...always]) {
    const T = level0.pieces[tIdx];

    // walk the feeding beam graph backwards from the target
    const visiting = new Set();
    const seenSeg = new Set();
    const feeders = [];       // piece indices on the feeding path (incl. target)
    const emitters = new Set();
    const stack = [[T.x, T.y]];
    feeders.push(tIdx);
    let hasRot = false;
    while (stack.length) {
      const [x, y] = stack.pop();
      const ck = `${x},${y}`;
      if (visiting.has(ck)) continue;
      visiting.add(ck);
      const gp = level0.grid[y * level0.w + x];
      if (gp >= 0) {
        const p = level0.pieces[gp];
        if (p.type === 'emitter') { emitters.add(gp); if (!feeders.includes(gp)) feeders.push(gp); continue; }
        if (!feeders.includes(gp)) feeders.push(gp);
        if (p.type === 'mirror' || p.type === 'prism' || p.type === 'splitter') hasRot = true;
      }
      for (const si of (byEnd.get(ck) || [])) {
        if (seenSeg.has(si)) continue;
        seenSeg.add(si);
        const s = trace0.segments[si];
        if (s.color !== T.color) continue; // wrong-colour beams do not light it
        for (const [cx, cy] of cellsOf(s)) {
          const pk = `${cx},${cy}`;
          if (!visiting.has(pk)) {
            stack.push([cx, cy]);
            const g = level0.grid[cy * level0.w + cx];
            if (g >= 0 && !feeders.includes(g) && level0.pieces[g].type !== 'emitter') feeders.push(g);
            if (g >= 0 && ['mirror', 'prism', 'splitter'].includes(level0.pieces[g].type)) hasRot = true;
          }
        }
      }
    }

    if (emitters.size !== 1) continue; // ambiguous feeding: leave alone
    const E = level0.pieces[[...emitters][0]];
    const dName = LV.DIRNAMES[E.dir];
    const dxy = DIRS[dName];

    // candidacy: re-anchor on the FINAL feeding lane into the always-lit
    // target (the segment from its upstream bender on), so fork-feeding
    // upstream of that lane is untouched
    const occ = new Set();
    for (const o of lvl.objects) {
      if (o.t === 'target' && o.x === T.x && o.y === T.y && o.color === T.color) continue;
      occ.add(`${o.x},${o.y}`);
    }
    const sameOthers = lvl.objects.filter((o) =>
      o.t !== 'target' ? o.color === T.color && !(o.x === E.x && o.y === E.y)
                       : o.color === T.color && !(o.x === T.x && o.y === T.y));

    const fed = trace0.segments.filter((s) => s.x2 === T.x && s.y2 === T.y && s.color === T.color);
    const NAME = { '0,-1': 'N', '1,0': 'E', '0,1': 'S', '-1,0': 'W' };
    const cands = [];
    for (const seg of fed) {
      const bIdx = level0.grid[seg.y1 * level0.w + seg.x1];
      if (bIdx < 0) continue;
      const dx = Math.sign(seg.x2 - seg.x1), dy = Math.sign(seg.y2 - seg.y1);
      const dName = NAME[`${dx},${dy}`];
      if (!dName) continue;
      for (let s1 = 1; ; s1++) {
        const mx = seg.x1 + dx * s1, my = seg.y1 + dy * s1;
        if (mx < 0 || my < 0 || mx >= lvl.wh[0] || my >= lvl.wh[1]) break;
        if (occ.has(`${mx},${my}`)) break;
        for (const pd of PERP[dName]) {
          for (let s2 = 1; ; s2++) {
            const tx = mx + DIRS[pd][0] * s2, ty = my + DIRS[pd][1] * s2;
            if (tx < 0 || ty < 0 || tx >= lvl.wh[0] || ty >= lvl.wh[1]) break;
            if (occ.has(`${tx},${ty}`)) break;
            const far = (p) => Math.max(Math.abs(tx - p.x), Math.abs(ty - p.y)) >= 3;
            if (Math.max(Math.abs(tx - E.x), Math.abs(ty - E.y)) >= 3 && sameOthers.every(far)) {
              cands.push({ mx, my, dName, pd, tx, ty });
              break; // farther targets on this bend share the lane — one is enough
            }
          }
        }
      }
    }

    const label = `L${lvl.id} ${T.color} E(${E.x},${E.y},${E.dir}) → T(${T.x},${T.y})`;
    if (!cands.length) { report.push(`${label}  NO CANDIDATE ✗`); failures++; continue; }

    // splice: replace the T token with M + T
    const objs = lvl.objects;
    const pos = objs.findIndex((o) => o.t === 'target' && o.x === T.x && o.y === T.y && o.color === T.color);
    let chosen = null, chosenTrial = null;
    for (const cand of cands) {
      const orient = SLASH.has(`${cand.dName}>${cand.pd}`) ? 0 : 1;
      const replacement = [
        { t: 'mirror', x: cand.mx, y: cand.my, orient },
        { t: 'target', x: cand.tx, y: cand.ty, color: T.color },
      ];
      const trial = objs.slice(0, pos).concat(replacement, objs.slice(pos + 1));
      const lv2 = Engine.buildLevel(LV.makeDef(lvl, trial)); // spawn stale — verification uses a zero state
      const mods = lv2.rotPieces.map((r) => r.mod);
      const total = mods.reduce((a, b) => a * b, 1);
      if (total > MAX_STATES) continue;
      const sol = Engine.solve(lv2, lv2.rotPieces.map(() => 0));
      if (sol.solvable) { chosen = cand; chosenTrial = replacement; break; }
    }

    if (!chosen) { report.push(`${label}  NO SOLVABLE CANDIDATE of ${cands.length} ✗`); failures++; continue; }

    objs.splice(pos, 1, ...chosenTrial);
    touched.push(lvl.id);
    report.push(`${label}  → M(${chosen.mx},${chosen.my}) T(${chosen.tx},${chosen.ty})  ✓`);
  }
}

for (const id of new Set(touched)) {
  const lvl = levels.find((l) => l.id === id);
  LV.saveObjects(lines, lvl, lvl.objects);
}
fs.writeFileSync(LV.LEVELS_PATH, lines.join('\n'));
console.log(report.join('\n'));
console.log(`always-lit chains re-anchored; ${failures} failure(s)`);
process.exit(failures ? 1 : 0);
