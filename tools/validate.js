/* Node validator: verifies every level is solvable, computes par (minimal taps),
 * and reports the first optimal solution step. Exit code 1 on any failure. */
'use strict';
const path = require('path');
const Engine = require('../js/engine.js');
const Levels = require('../js/levels.js');

let failures = 0;
const rows = [];

console.log('Laser Maze level validation\n' + '='.repeat(72));
console.log('id | grid | rot | targets | par | status');
console.log('-'.repeat(72));

for (const def of Levels.LEVELS) {
  const level = Engine.buildLevel(def);
  const cells = new Set();
  let bad = null;

  for (const p of level.pieces) {
    if (p.x < 0 || p.y < 0 || p.x >= level.w || p.y >= level.h) bad = `piece out of bounds at (${p.x},${p.y})`;
    const key = p.x + ',' + p.y;
    if (cells.has(key)) bad = `two pieces share cell (${key})`;
    cells.add(key);
    if (p.type === 'emitter' && p.dir === null) bad = 'emitter missing direction';
  }
  if (level.targets.length === 0) bad = 'no targets';
  const stateCount = level.rotPieces.reduce((a, r) => a * r.mod, 1);
  if (stateCount > 262144) bad = `state space too large to brute-force (${stateCount})`;

  const init = level.rotPieces.map(r => level.pieces[r.idx].orient);
  const sol = Engine.solve(level, init);

  const status = bad ? bad : (sol.solvable ? `OK ` : 'UNSOLVABLE');
  const parTxt = sol.solvable ? String(sol.par) : '–';
  if (bad || !sol.solvable || sol.par === 0) failures++;
  if (sol.par === 0 && !bad) console.log(`  !! Level ${level.id} is already solved at start (par 0)`);

  rows.push({ id: level.id, grid: level.w + 'x' + level.h, rot: level.rotPieces.length,
    targets: level.targets.length, par: sol.solvable ? sol.par : null, bad });

  const flag = (bad || !sol.solvable) ? 'FAIL' : (sol.par === 0 ? 'WARN' : 'ok  ');
  console.log(`${String(level.id).padStart(2)} | ${String(level.w + 'x' + level.h).padStart(4)} |  ${level.rotPieces.length}  |   ${level.targets.length}     | ${parTxt.padStart(3)} | ${flag} ${bad ? bad : ''}`);
}

console.log('-'.repeat(72));
const pars = rows.filter(r => r.par !== null).map(r => r.par);
console.log(`par range: ${Math.min(...pars)}–${Math.max(...pars)}, avg ${(pars.reduce((a, b) => a + b, 0) / pars.length).toFixed(2)}`);
console.log(failures === 0 ? `\nALL ${Levels.LEVELS.length} LEVELS VERIFIED ✓` : `\n${failures} LEVEL(S) NEED FIXES ✗`);
process.exit(failures === 0 ? 0 : 1);
