/* declump.js — push same-colour pieces apart.
 *
 * After destub.js re-anchors the always-lit chains, some same-colour pieces
 * may still sit within 2 cells of each other. This tool slides a piece along
 * a free straight lane — a target anywhere on its feeding beam's lane (which
 * means from its upstream bender onward), an emitter anywhere on its own
 * beam's lane — so that it lands ≥3 Chebyshev from every same-colour piece.
 * Sliding a piece strictly along its own beam lane keeps every rotation
 * state's lit-set identical, and the level's par from the invariant reference
 * state is re-verified after every candidate — moves that would disturb
 * another beam (wrong-colour absorption offsets) are rejected.
 *
 * Levels whose state space exceeds 262144 are skipped; design.js re-pins the
 * spawn afterwards. Usage: node tools/declump.js
 */
'use strict';
const fs = require('fs');
const Engine = require('../js/engine.js');
const LV = require('./lvlib.js');

const { DIRS, DIRNAMES } = LV;
const MAX_STATES = 262144;

const { lines, levels } = LV.loadLevels();
const summary = [];
const leftovers = [];
let moved = 0;

for (const lvl of levels) {
  const wh = lvl.wh;
  const inB = (x, y) => x >= 0 && y >= 0 && x < wh[0] && y < wh[1];

  const spawnRef = LV.valueOfSpawn(lvl);
  const level0 = Engine.buildLevel(LV.makeDef(lvl, lvl.objects, spawnRef || undefined));
  const total = level0.rotPieces.map((r) => r.mod).reduce((a, b) => a * b, 1);
  if (total > MAX_STATES) { summary.push(`L${lvl.id}  skipped: ${total} states`); continue; }

  // invariant state: the file's spawn when it addresses every wheel, else an
  // all-zeros state (structures freshly re-anchored by destub.js carry stale
  // spawns; design.js re-pins them later)
  const refState = spawnRef && spawnRef.length === level0.rotPieces.length
    ? spawnRef
    : level0.rotPieces.map(() => 0);
  const refPar = Engine.solve(level0, refState).par;
  if (refPar == null) { summary.push(`L${lvl.id}  skipped: reference state unsolvable`); continue; }

  /** first feeding segment into a target at the reference state */
  function feedingSeg(level, tObj, state) {
    const tr = Engine.trace(level, state);
    for (const s of tr.segments) {
      if (s.x2 === tObj.x && s.y2 === tObj.y && s.color === tObj.color) return s;
    }
    return null;
  }

  /** straight walk from (sx,sy) in (dx,dy): free cells nearest-first */
  function laneCells(sx, sy, dx, dy, pos) {
    const cells = [];
    for (let k = 1; k < 40; k++) {
      const cx = sx + dx * k, cy = sy + dy * k;
      if (!inB(cx, cy)) break;
      let occ = false;
      for (let i = 0; i < lvl.objects.length; i++) {
        if (i === pos) continue;
        if (lvl.objects[i].x === cx && lvl.objects[i].y === cy) { occ = true; break; }
      }
      if (occ) break;
      cells.push([cx, cy]);
    }
    return cells;
  }

  const findToken = (p) => lvl.objects.findIndex(
    (o) => o.t === p.type && o.x === p.x && o.y === p.y && (!o.color || o.color === p.color));

  const skipPairs = new Set();
  for (let pass = 0; pass < 10; pass++) {
    const levelP = Engine.buildLevel(LV.makeDef(lvl, lvl.objects, refState));

    // first unfixable-unmarked same-colour pair within 2
    const byC = new Map();
    for (const p of levelP.pieces) {
      if (p.color) {
        if (!byC.has(p.color)) byC.set(p.color, []);
        byC.get(p.color).push(p);
      }
    }
    const allPairs = [];
    for (const [c, pts] of byC) {
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          if (LV.cheb(pts[i], pts[j]) <= 2) allPairs.push({ c, a: pts[i], b: pts[j] });
        }
      }
    }
    const pair = allPairs.find((p) => {
      const s1 = `${p.c}:${p.a.x},${p.a.y}-${p.b.x},${p.b.y}`;
      const s2 = `${p.c}:${p.b.x},${p.b.y}-${p.a.x},${p.a.y}`;
      return !skipPairs.has(s1) && !skipPairs.has(s2);
    });
    if (!pair) break;

    const sig = `${pair.c}:${pair.a.x},${pair.a.y}-${pair.b.x},${pair.b.y}`;
    let fixed = false;

    for (const mem of [pair.a, pair.b]) {
      const pos = findToken(mem);
      if (pos < 0) continue;
      const token = lvl.objects[pos];

      // candidate cells, nearest-first
      let cells = [];
      if (token.t === 'target') {
        const seg = feedingSeg(levelP, token, refState);
        if (seg) {
          // full feeding lane: every cell from the upstream bender onward
          const dx = Math.sign(seg.x2 - seg.x1), dy = Math.sign(seg.y2 - seg.y1);
          cells = laneCells(seg.x1, seg.y1, dx, dy, pos);
        } else {
          // unlit at the reference state — try every direction
          for (const dn of DIRNAMES) {
            const [dx, dy] = DIRS[dn];
            cells = cells.concat(laneCells(token.x, token.y, dx, dy, pos));
          }
        }
      } else if (token.t === 'emitter') {
        // anywhere on its outgoing beam lane: both along the fire direction
        // and back behind the muzzle (beam origin slides, lane is unchanged)
        const opp = { N: 'S', S: 'N', E: 'W', W: 'E' }[token.dir];
        for (const dn of [opp, token.dir]) {
          const [dx, dy] = DIRS[dn];
          cells = cells.concat(laneCells(token.x, token.y, dx, dy, pos));
        }
      }

      const others = lvl.objects.filter((o) => o.color === pair.c && o !== token);
      // spacing bar: ≥3 from every other same-colour piece — partner included

      for (const [nx, ny] of cells) {
        if (nx === token.x && ny === token.y) continue;
        if (others.some((o) => Math.max(Math.abs(nx - o.x), Math.abs(ny - o.y)) <= 2)) continue;
        const oldX = token.x, oldY = token.y;
        lvl.objects[pos] = { ...token, x: nx, y: ny };
        const lv2 = Engine.buildLevel(LV.makeDef(lvl, lvl.objects, refState));
        const par2 = Engine.solve(lv2, refState).par;
        if (par2 === refPar) {
          moved++;
          fixed = true;
          summary.push(`L${lvl.id}  ${pair.c} ${token.t} (${oldX},${oldY}) → (${nx},${ny})`);
          break;
        }
        lvl.objects[pos] = { ...token, x: oldX, y: oldY }; // revert
      }
      if (fixed) break;
    }

    // last resort: slide the target member together with its upstream bender —
    // the bender moves along its own feeding lane, which re-opens the far side
    // of the outgoing lane for the target (par invariance re-verified)
    if (!fixed) fixed = (() => {
      const mem = pair.a.type === 'target' ? pair.a : pair.b.type === 'target' ? pair.b : null;
      if (!mem) return false;
      const posT = findToken(mem);
      if (posT < 0) return false;
      const tokenT = lvl.objects[posT];

      const sol = Engine.solve(levelP, refState);
      if (!sol.solvedState) return false;
      const winTrace = Engine.trace(levelP, sol.solvedState);
      const segsT = winTrace.segments.filter(
        (s) => s.x2 === tokenT.x && s.y2 === tokenT.y && s.color === tokenT.color);
      for (const segT of segsT) {
        const gB = levelP.grid[segT.y1 * levelP.w + segT.x1];
        if (gB < 0) continue;
        const B = levelP.pieces[gB];
        if (!['mirror', 'prism', 'splitter', 'fixed'].includes(B.type)) continue; // plain emitter cases were tried above
        const posB = lvl.objects.findIndex((o) => o.t === B.type && o.x === B.x && o.y === B.y);
        if (posB < 0) continue;
        const tokenB = lvl.objects[posB];
        const segB = winTrace.segments.find(
          (s) => s.x2 === B.x && s.y2 === B.y && s.color === tokenT.color);
        if (!segB) continue; // colour-restoring feeders unsupported
        const dirB = [Math.sign(segB.x2 - segB.x1), Math.sign(segB.y2 - segB.y1)];
        const dirT = [Math.sign(segT.x2 - segT.x1), Math.sign(segT.y2 - segT.y1)];

        const rest = lvl.objects.filter((o, i) => i !== posT && i !== posB);
        const walk = (sx, sy, dx, dy) => {
          const cs = [];
          for (let k = 1; k < 40; k++) {
            const cx = sx + dx * k, cy = sy + dy * k;
            if (!inB(cx, cy)) break;
            if (rest.some((o) => o.x === cx && o.y === cy)) break;
            cs.push([cx, cy]);
          }
          return cs;
        };
        const others = lvl.objects.filter((o, i) => o.color === tokenT.color && i !== posT);

        for (const bcell of [
          ...walk(tokenB.x, tokenB.y, dirB[0], dirB[1]),
          ...walk(tokenB.x, tokenB.y, -dirB[0], -dirB[1]),
        ]) {
          for (const [tx, ty] of walk(bcell[0], bcell[1], dirT[0], dirT[1])) {
            if (tx === tokenT.x && ty === tokenT.y) continue;
            if (others.some((o) => Math.max(Math.abs(tx - o.x), Math.abs(ty - o.y)) <= 2)) continue;
            const trial = lvl.objects.map((o, i) => {
              if (i === posT) return { ...o, x: tx, y: ty };
              if (i === posB) return { ...o, x: bcell[0], y: bcell[1] };
              return o;
            });
            const lv2 = Engine.buildLevel(LV.makeDef(lvl, trial, refState));
            const par2 = Engine.solve(lv2, refState).par;
            if (par2 === refPar) {
              lvl.objects[posT] = trial[posT];
              lvl.objects[posB] = trial[posB];
              moved++;
              summary.push(`L${lvl.id}  ${pair.c} group: ${tokenT.t} (${tokenT.x},${tokenT.y})→(${tx},${ty}) with ${B.type} (${tokenB.x},${tokenB.y})→(${bcell[0]},${bcell[1]})`);
              return true;
            }
          }
        }
      }
      return false;
    })();

    if (!fixed) {
      leftovers.push(`L${lvl.id}  ${pair.c} (${pair.a.x},${pair.a.y})–(${pair.b.x},${pair.b.y})`);
      skipPairs.add(sig);
    }
  }
}

for (const lvl of levels) LV.saveObjects(lines, lvl, lvl.objects);
fs.writeFileSync(LV.LEVELS_PATH, lines.join('\n'));
console.log(summary.join('\n'));
console.log(leftovers.length ? `leftover pairs:\n${leftovers.join('\n')}` : 'no leftover pairs');
console.log(`${moved} piece(s) relocated`);
