/* Level designer: picks the starting orientation for every level to keep the
 * run monotonically harder: level n's par must be ≥ level n-1's.
 *
 * For a given structure (pieces, walls, emitters, targets) every combination of
 * rotatable orientations is a state. Taps always advance (+1) a single wheel, so
 * the tap graph is directed but every edge is invertible by un-tapping the same
 * wheel. A reverse multi-source BFS from ALL solved states therefore computes,
 * for every state, exactly how many forward taps it needs to win ("par from
 * that start").
 *
 * design.js picks the start state whose distance is EXACTLY the level's ramp
 * target (never pre-solved), and rewrites js/levels.js by replacing each def's
 * `spawn: [...]/spawn: null` line (file order = level order) with the chosen
 * state. If a structure cannot reach its target depth it fails loudly with the
 * achievable max (BEEF the structure).
 *
 * Usage: node tools/design.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Engine = require('../js/engine.js');
const Levels = require('../js/levels.js');

// per-level par targets — chapter structure (sets of 10, one colour-tier per
// set). Inside a set: starts easy, climbs level by level, set finale = set
// peak. Each new set re-starts a little easier than the previous finale
// (fresh-breath break) but at a higher baseline than its own set start.
const TARGETS = [
  // set 1: single colour  (1–10) — steady rise, finale hardest
  1,  2,  3,  4,  5,  6,  7,  8,  9, 10,
  // set 2: two colours   (11–20)
  6,  7,  8,  9, 10, 11, 12, 13, 14, 15,
  // set 3: three colours (21–30)
  9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
  // set 4: four colours  (31–40)
 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
  // set 5: five colours  (41–50)
 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
];const MAX_STATES = 262144;

function enumerateStates(rotPieces) {
  const mods = rotPieces.map(r => r.mod);
  const total = mods.reduce((a, b) => a * b, 1);
  const states = [];
  for (let n = 0; n < total && n < MAX_STATES; n++) {
    const s = [];
    let t = n;
    for (let i = 0; i < mods.length; i++) { s.push(t % mods[i]); t = (t - s[i]) / mods[i]; }
    states.push(s);
  }
  return states;
}

function analyze(def, target) {
  const level = Engine.buildLevel(def);
  const mods = level.rotPieces.map(r => r.mod);
  if (!mods.length) return { status: 'norot', par: 0, spawn: null, level };

  const states = enumerateStates(level.rotPieces);
  const solved = states.filter(s => Engine.trace(level, s).win);
  if (!solved.length) return { status: 'unsolvable', par: null, spawn: null, level };

  // reverse (un-tap) multi-source BFS from the solved set
  const key = s => s.join('');
  const dist = new Map();
  const queue = [];
  for (const s of solved) { dist.set(key(s), 0); queue.push(s); }
  for (let qi = 0; qi < queue.length; qi++) {
    const s = queue[qi];
    for (let i = 0; i < mods.length; i++) {
      if (mods[i] === 1) continue;
      const ns = s.slice();
      ns[i] = (ns[i] - 1 + mods[i]) % mods[i];
      const k = key(ns);
      if (!dist.has(k)) { dist.set(k, dist.get(key(s)) + 1); queue.push(ns); }
    }
  }

  let maxAll = 0, atTarget = null, bestLit = Infinity, litZero = false;
  for (const s of states) {
    const d = dist.get(key(s)) || 0;
    if (d > maxAll) maxAll = d;
    if (d === target) {
      // prefer a spawn whose board lights NO target on arrival ("pre-solved"
      // targets read as free wins); fall back to the fewest lit
      const lit = Engine.trace(level, s).lit.size;
      if (lit < bestLit) { bestLit = lit; atTarget = s; }
      if (lit === 0) { litZero = true; break; }
    }
  }
  if (maxAll < target) return { status: 'depth-short', par: null, spawn: null, level, maxAll };
  if (!atTarget) return { status: 'no-state-at-depth', par: null, spawn: null, level, maxAll };
  return { status: 'ok', par: target, maxAll, prelit: bestLit, litZero, solvedCount: solved.length, total: states.length, spawn: atTarget, level };
}

function main() {
  const levelsPath = path.join(__dirname, '..', 'js', 'levels.js');
  const lines = fs.readFileSync(levelsPath, 'utf8').split(/\r?\n/);
  const spawnLineIdx = [];
  lines.forEach((l, i) => { if (/^\s*spawn:\s*(null|\[)/.test(l)) spawnLineIdx.push(i); });

  if (spawnLineIdx.length !== Levels.LEVELS.length) {
    console.error(`ERROR: found ${spawnLineIdx.length} spawn lines but ${Levels.LEVELS.length} levels.\n` +
      'Every def in js/levels.js needs exactly one `spawn: null,` (or spawn array) line.');
    process.exit(2);
  }

  let failures = 0;
  const pars = [];
  console.log('Level design report — monotone ramp, exact par targets\n' + '='.repeat(74));
  console.log('id | tier | target |  states | solved | D(max) | spawn');
  console.log('-'.repeat(74));

  Levels.LEVELS.forEach((def, i) => {
    const tier = Math.ceil(def.id / 5);
    const target = TARGETS[i];
    const r = analyze(def, target);
    if (r.status !== 'ok') {
      failures++;
      console.log(`${String(def.id).padStart(2)} | T${tier}  | ${String(target).padStart(6)} | ${r.status.toUpperCase()} (max depth ${r.maxAll != null ? r.maxAll : '—'})`);
      return;
    }
    pars.push(r.par);
    lines[spawnLineIdx[i]] = lines[spawnLineIdx[i]].replace(
      /^(\s*)spawn:\s*(null|\[[^\]]*\])(,?)\s*(.*)$/,
      (_m, ind, _old, _c, rest) => `${ind}spawn: [${r.spawn.join(', ')}],${rest ? ' ' + rest : ''}`
    );
    console.log(
      `${String(def.id).padStart(2)} | T${tier}  | ${String(target).padStart(6)} | ${String(r.total).padStart(7)} | ${String(r.solvedCount).padStart(6)} | ${String(r.maxAll).padStart(6)} | prelit ${r.prelit}${r.litZero ? ' ✓' : ''} | [${r.spawn.join(',')}]`
    );
  });

  if (!failures) fs.writeFileSync(levelsPath, lines.join('\n'), 'utf8');
  console.log('-'.repeat(74));
  console.log(`par range: ${Math.min(...pars)}–${Math.max(...pars)}  avg ${(pars.reduce((a, b) => a + b, 0) / pars.length).toFixed(2)}`);
  console.log(failures ? `${failures} LEVEL(S) FAILED DESIGN ANALYSIS ✗` : `spawn written for all ${Levels.LEVELS.length} levels ✓`);
  process.exit(failures ? 1 : 0);
}

main();
