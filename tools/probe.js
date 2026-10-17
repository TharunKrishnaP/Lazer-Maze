/* Probe one candidate level structure: node tools\probe.js '9,9' '<objects literal>'
 * The objects literal is JS using the same factories as levels.js:
 *   E(x,y,'dir',color) T(x,y,color) M(x,y,o) P(x,y,o) FX(x,y,o) WALL(x,y) S(x,y,o) Z(x,y,color)
 * Prints: D (max BFS depth from solved set), solved count, and a shortest-path check.
 */
'use strict';
const Engine = require('../js/engine.js');

const E = (x, y, dir, color) => ({ t: 'emitter', x, y, dir, color });
const T = (x, y, color) => ({ t: 'target', x, y, color });
const M = (x, y, orient) => ({ t: 'mirror', x, y, orient });
const P = (x, y, orient) => ({ t: 'prism', x, y, orient });
const FX = (x, y, orient) => ({ t: 'fixed', x, y, orient });
const WALL = (x, y) => ({ t: 'wall', x, y });
const S = (x, y, orient) => ({ t: 'splitter', x, y, orient });
const Z = (x, y, color) => ({ t: 'filter', x, y, color });

const size = process.argv[2].split(',').map(Number);
const objects = eval(`[ ${process.argv[3]} ]`);

const def = { id: 0, size, objects };
const level = Engine.buildLevel(def);
const mods = level.rotPieces.map(r => r.mod);
console.log(`rot: ${mods.length}  state count: ${mods.reduce((a, b) => a * b, 1)}`);
if (!mods.length) process.exit(1);

function enumerateStates() {
  const total = mods.reduce((a, b) => a * b, 1);
  const states = [];
  for (let n = 0; n < total && n < 800000; n++) {
    const s = []; let t = n;
    for (let i = 0; i < mods.length; i++) { s.push(t % mods[i]); t = (t - s[i]) / mods[i]; }
    states.push(s);
  }
  return states;
}
const states = enumerateStates();
const key = s => s.join('');
const solvedSet = [];
for (const s of states) if (Engine.trace(level, s).win) solvedSet.push(s);
console.log(`solved states: ${solvedSet.length}${solvedSet.length ? '  e.g. [' + solvedSet[0].join(',') + ']' : '  (UNSOLVABLE)'}`);
if (!solvedSet.length) process.exit(1);

const dist = new Map(); const q = [];
for (const s of solvedSet) { dist.set(key(s), 0); q.push(s); }
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
console.log(`D (max depth): ${D}`);
// depth histogram to confirm exact-target spawns exist
const hist = {};
for (const s of states) { const d = dist.get(key(s)) || 0; hist[d] = (hist[d] || 0) + 1; }
console.log('depth histogram:', JSON.stringify(hist));
