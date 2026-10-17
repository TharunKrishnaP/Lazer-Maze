/* Auto-beef: raises each level's BFS depth to its ramp target by converting
 * some (M)irrors into (P)risms. A prism behaves EXACTLY like a mirror in its
 * '/' and '\' states and adds two extra BLOCK states, so every conversion
 * keeps the level solvable while growing the state space (more depth).
 *
 * For every level the tool:
 *   1. enumerates subsets of mirrors (size 1..4),
 *   2. simulates each subset (reverse-BFS depth D, solved count),
 *   3. picks the minimal-size subset with D ≥ target, preferring the uniquest
 *      solution and then the deepest board,
 *   4. rewrites that def's `M(x, y, o)` tokens into `P(...)` in js/levels.js.
 *
 * Levels with no workable subset are reported FAIL for manual redesign.
 *
 * Usage: node tools/beef.js [levelIds ...] (default: all)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Engine = require('../js/engine.js');

// same contract as design.js — chapter structure, sets of 10
const TARGETS = [
  1,  2,  3,  4,  5,  6,  7,  8,  9, 10,
  6,  7,  8,  9, 10, 11, 12, 13, 14, 15,
  9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
];

const LEVELS_PATH = path.join(__dirname, '..', 'js', 'levels.js');
const MAX_STATES = 200000;

function combos(arr, k) {
  const out = [];
  const rec = (start, acc) => {
    if (acc.length === k) { out.push(acc.slice()); return; }
    for (let i = start; i < arr.length; i++) { acc.push(arr[i]); rec(i + 1, acc); acc.pop(); }
  };
  rec(0, []);
  return out;
}

function enumerate(states0) {
  const total = states0.reduce((a, b) => a * b, 1);
  if (total > MAX_STATES) return null;
  const states = [];
  for (let n = 0; n < total; n++) {
    const s = []; let t = n;
    for (let i = 0; i < states0.length; i++) { s.push(t % states0[i]); t = (t - s[i]) / states0[i]; }
    states.push(s);
  }
  return states;
}

/** Convert chosen mirror coords to prisms in a def. */
function withConversions(def, convSet) {
  const objects = def.objects.map((o) =>
    (o.t === 'mirror' && convSet.has(`${o.x},${o.y}`))
      ? { t: 'prism', x: o.x, y: o.y, orient: o.orient }
      : o
  );
  return { ...def, objects };
}

/** D (max BFS depth) & solved stats for a def with a given conversion set. */
function measure(def, convSet) {
  const level = Engine.buildLevel(withConversions(def, convSet));
  const mods = level.rotPieces.map(r => r.mod);
  const states = enumerate(mods);
  if (!states) return null;
  const key = s => s.join('');
  const solved = states.filter(s => Engine.trace(level, s).win);
  if (!solved.length) return null;
  const dist = new Map(); const q = [];
  for (const s of solved) { dist.set(key(s), 0); q.push(s); }
  for (let qi = 0; qi < q.length; qi++) {
    const s = q[qi];
    for (let i = 0; i < mods.length; i++) {
      if (mods[i] === 1) continue;
      const ns = s.slice(); ns[i] = (ns[i] - 1 + mods[i]) % mods[i];
      const k = key(ns);
      if (!dist.has(k)) { dist.set(k, dist.get(key(s)) + 1); q.push(ns); }
    }
  }
  let D = 0;
  for (const s of states) { const d = dist.get(key(s)) || 0; if (d > D) D = d; }
  return { D, solvedCount: solved.length, total: states.length };
}

// ---- text rewriting ---------------------------------------------------------

function applyConversions(rawText, id, convSet) {
  const lines = rawText.split('\n');
  let inBlock = false, start = -1, end = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/id:\s*(\d+),/);
    if (m) {
      if (inBlock && start >= 0 && end < 0) { end = i; break; }
      if (+m[1] === id) { inBlock = true; start = i; }
    }
  }
  if (start < 0) throw new Error(`level ${id} block not found`);
  const last = end < 0 ? lines.length : end;
  for (let i = start; i < last; i++) {
    lines[i] = lines[i].replace(/M\((\d+),\s*(\d+),\s*(\d+)\)/g, (mm, x, y, o) => {
      if (convSet.has(`${x},${y}`)) return `P(${x}, ${y}, ${o})`;
      return mm;
    });
  }
  return lines.join('\n');
}

// ---- main -------------------------------------------------------------------

const ids = process.argv.slice(2).map(Number);
const want = (id) => (ids.length ? ids.includes(id) : true);
const raw = fs.readFileSync(LEVELS_PATH, 'utf8');

const defs = require('../js/levels.js').LEVELS;
const report = [];
let changedText = raw;
let failures = 0;
const totals = { best: 0, conversions: 0 };

for (const def of defs) {
  const target = TARGETS[def.id - 1];
  if (!want(def.id)) continue;

  const base = measure(def, new Set());
  if (!base) { report.push(`${String(def.id).padStart(2)} | target ${target} | UNSOLVABLE/TOO-BIG base state space`); failures++; continue; }
  if (base.D >= target) {
    report.push(`${String(def.id).padStart(2)} | target ${String(target).padStart(2)} | already D=${base.D} ✓`);
    continue;
  }

  const mirrors = def.objects.filter(o => o.t === 'mirror').map(o => `${o.x},${o.y}`);
  let pick = null;
  for (let k = 1; k <= Math.min(6, mirrors.length); k++) {
    const cands = [];
    for (const combo of combos(mirrors, k)) {
      const r = measure(def, new Set(combo));
      if (r && r.D >= target) cands.push({ combo, ...r });
    }
    if (cands.length) {
      // uniquest solve first, then deepest, then stable order
      cands.sort((a, b) => a.solvedCount - b.solvedCount || b.D - a.D);
      pick = cands[0];
      break;
    }
  }

  if (!pick) {
    report.push(`${String(def.id).padStart(2)} | target ${String(target).padStart(2)} | FAIL (best D=${base.D} base, no subset up to size 4 reached ${target})`);
    failures++;
    continue;
  }
  const convSet = new Set(pick.combo);
  changedText = applyConversions(changedText, def.id, convSet);
  totals.best++;
  totals.conversions += pick.combo.length;
  report.push(
    `${String(def.id).padStart(2)} | target ${String(target).padStart(2)} | D ${base.D}→${pick.D} | solved ${base.solvedCount}→${pick.solvedCount} | states ${base.total}→${pick.total} | +${pick.combo.length} prisms @ [${pick.combo.join(' ')}]`
  );
}

fs.writeFileSync(LEVELS_PATH, changedText);
console.log(report.join('\n'));
console.log(`\nbeefed: ${totals.best} levels, ${totals.conversions} mirror→prism conversions, ${failures} failures`);
process.exit(failures ? 2 : 0);
