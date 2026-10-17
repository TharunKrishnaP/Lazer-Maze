/* Laser Maze — core engine: grid, ray tracing, win detection, BFS solver.
 * Environment-agnostic: works in browser (window.LaserEngine) and Node (module.exports).
 *
 * Directions are indices into DIRS: 0=N, 1=E, 2=S, 3=W.
 * Mirror orientation: 0 = "/" (SW–NE), 1 = "\" (NW–SE).
 * Prism orientation (rotates 45° per tap, 4 states):
 *   0 = "/" reflects, 1 = "|" blocks, 2 = "\" reflects, 3 = "—" blocks.
 * Splitter orientation like a mirror; it both reflects and transmits the beam.
 * Filter recolors any beam passing through and lets it continue.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LaserEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N, E, S, W
  const DIR_INDEX = { N: 0, E: 1, S: 2, W: 3 };
  const DIR_NAMES = ['N', 'E', 'S', 'W'];

  const COLOR_HEX = {
    red: '#ff3b5c',
    green: '#3dfb7c',
    blue: '#38b6ff',
    yellow: '#ffd23b',
    magenta: '#ff5ce4',
    cyan: '#46f0e0',
    orange: '#ff8a3b',
    purple: '#9d6bff',
  };

  const MAX_BOUNCES = 64;
  const MAX_WALK_CELLS = 400;
  const MAX_SEGMENTS = 600;

  // ---- Level construction -------------------------------------------------

  function buildLevel(def) {
    const w = def.w || (def.size ? def.size[0] : 8);
    const h = def.h || (def.size ? def.size[1] : 8);
    const pieces = [];
    const grid = new Int16Array(w * h).fill(-1);
    const rotPieces = [];   // {idx, mod} rotation cycle length
    const emitters = [];
    const targets = [];

    for (const o of def.objects) {
      const piece = {
        type: o.t, x: o.x, y: o.y,
        orient: o.orient || 0,
        color: o.color || null,
        dir: o.dir !== undefined ? DIR_INDEX[o.dir] : null,
        visualAngle: null, // plain object, fine
      };
      const idx = pieces.push(piece) - 1;
      grid[o.y * w + o.x] = idx;
      if (piece.type === 'emitter') emitters.push(idx);
      if (piece.type === 'target') targets.push(idx);
    }

    // rotatable metadata lives outside grid (mirror/pre-prism/splitter)
    pieces.forEach((p, idx) => {
      if (p.type === 'mirror') rotPieces.push({ idx, mod: 2 });
      if (p.type === 'prism') rotPieces.push({ idx, mod: 4 });
      if (p.type === 'splitter') rotPieces.push({ idx, mod: 2 });
    });

    // optional precomputed starting orientations (tools/design.js output)
    if (def.spawn) {
      def.spawn.forEach((o, i) => {
        if (i < rotPieces.length) pieces[rotPieces[i].idx].orient = o;
      });
    }

    return {
      id: def.id, name: def.name || `Level ${def.id}`, note: def.note || null,
      w, h, pieces, grid, rotPieces, emitters, targets,
      theme: def.theme || null,
    };
  }

  function pieceAt(level, x, y) {
    if (x < 0 || y < 0 || x >= level.w || y >= level.h) return null;
    const idx = level.grid[y * level.w + x];
    return idx < 0 ? null : level.pieces[idx];
  }

  // ---- Ray tracing --------------------------------------------------------

  // state: array of orientations indexed by rotPieces order (mirror/pre-prism/splitter)
  function stateKey(state) { return state.join(''); }

  function trace(level, state) {
    const lit = new Set();
    const segments = [];
    // beams spawned from the same piece+direction+color are exact duplicates
    // (paths are deterministic) — dedup keeps splitter-loop states cheap.
    const spawned = new Set();
    // map piece index -> rotation-state index (for rotatable pieces)
    const rotIndexByPiece = new Map();
    level.rotPieces.forEach((r, i) => rotIndexByPiece.set(r.idx, i));
    let segCount = 0;

    function pushSeg(x1, y1, x2, y2, color) {
      if (segCount >= MAX_SEGMENTS) return;
      segments.push({ x1, y1, x2, y2, color });
      segCount++;
    }

    function reflectDir(d, orient) {
      // 0=N,1=E,2=S,3=W ; "/" (orient 0): E→N, N→E, S→W, W→S
      // "\" (orient 1): E→S, S→E, N→W, W→N
      if (orient % 2 === 0) return [1, 0, 3, 2][d]; // "/" mapping via index swap
      return [3, 2, 1, 0][d];                        // "\" mapping
    }

    // effective orientation of a piece: rotatable pieces take the state's value
    function orientOf(p) {
      const ri = rotIndexByPiece.get(level.grid[p.y * level.w + p.x]);
      return ri === undefined ? p.orient : state[ri];
    }

    function walk(startIdx, d, color) {
      const start = level.pieces[startIdx];
      const q = [{ x: start.x, y: start.y, d, c: color }];
      while (q.length) {
        const beam = q.shift();
        let { x, y, d: dir, c: col } = beam;
        let thisB = 0;
        let runX = x, runY = y;
        let guard = 0;
        while (true) {
          if (guard++ > MAX_WALK_CELLS || thisB++ > MAX_BOUNCES) { break; }
          const nx = x + DIRS[dir][0], ny = y + DIRS[dir][1];
          if (nx < 0 || ny < 0 || nx >= level.w || ny >= level.h) {
            // exit across the edge — end at boundary midpoint
            pushSeg(runX, runY, x + DIRS[dir][0] * 0.5, y + DIRS[dir][1] * 0.5, col);
            break;
          }
          const p = pieceAt(level, nx, ny);
          if (!p) { x = nx; y = ny; continue; }

          if (p.type === 'wall' || p.type === 'emitter') {
            pushSeg(runX, runY, x + DIRS[dir][0] * 0.5, y + DIRS[dir][1] * 0.5, col);
            break;
          }
          if (p.type === 'target') {
            const targetIdx = level.grid[ny * level.w + nx];
            if (p.color === col) lit.add(targetIdx);
            pushSeg(runX, runY, nx, ny, col);
            break;
          }
          if (p.type === 'filter') {
            pushSeg(runX, runY, nx, ny, col);
            runX = nx; runY = ny;
            col = p.color;
            x = nx; y = ny;
            continue;
          }
          if (p.type === 'prism') {
            const o = orientOf(p);
            if (o === 1 || o === 3) { pushSeg(runX, runY, nx, ny, col); break; } // blocked
            pushSeg(runX, runY, nx, ny, col);
            runX = nx; runY = ny;
            x = nx; y = ny;
            dir = reflectDir(dir, o === 2 ? 1 : 0); // orient 0='/' 2='\'
            thisB++;
            continue;
          }
          if (p.type === 'mirror' || p.type === 'fixed') {
            pushSeg(runX, runY, nx, ny, col);
            runX = nx; runY = ny;
            x = nx; y = ny;
            dir = reflectDir(dir, orientOf(p));
            thisB++;
            continue;
          }
          if (p.type === 'splitter') {
            pushSeg(runX, runY, nx, ny, col);
            runX = nx; runY = ny;
            const spawnKey = level.grid[ny * level.w + nx] + ':' + dir + ':' + col;
            if (!spawned.has(spawnKey)) {
              spawned.add(spawnKey);
              q.push({ x: nx, y: ny, d: dir, c: col });
            }
            x = nx; y = ny;
            dir = reflectDir(dir, orientOf(p));
            thisB++;
            continue;
          }
          x = nx; y = ny;
        }
      }
    }

    for (const eidx of level.emitters) {
      const e = level.pieces[eidx];
      walk(eidx, e.dir, e.color);
    }

    const win = level.targets.length > 0 && level.targets.every(t => lit.has(t));
    return { segments, lit, win };
  }

  // ---- Solver (BFS over rotation states) ----------------------------------

  function applyTap(level, state, runIdx) {
    const next = state.slice();
    next[runIdx] = (next[runIdx] + 1) % level.rotPieces[runIdx].mod;
    return next;
  }

  function isSolved(level, state) {
    return trace(level, state).win;
  }

  // BFS from a given state; returns { dist, parent, keyOf } maps.
  var bfsResult = function (level, startState) {
    const startKey = stateKey(startState);
    const dist = new Map([[startKey, 0]]);
    const parent = new Map(); // key -> [prevKey, runIdx]
    const states = new Map([[startKey, startState]]);
    const queue = [startKey];
    const cap = 2_000_000;
    let solved = null;

    while (queue.length) {
      const key = queue.shift();
      if (solved && dist.get(key) > dist.get(solved)) continue;
      const st = states.get(key);
      if (!solved && isSolved(level, st)) { solved = key; }
      for (let i = 0; i < level.rotPieces.length; i++) {
        const nk = stateKey(applyTap(level, st, i));
        if (!dist.has(nk)) {
          const ns = applyTap(level, st, i);
          dist.set(nk, dist.get(key) + 1);
          parent.set(nk, [key, i]);
          states.set(nk, ns);
          if (!solved && isSolved(level, ns)) solved = nk;
          if (dist.size > cap) return { dist, parent, states, solved, overflow: true };
          queue.push(nk);
        }
      }
    }
    // if solved found mid-scan, its dist is final (BFS by construction)
    return { dist, parent, states, solved, overflow: false, par: solved ? dist.get(solved) : null };
  };

  function solutionPath(level, startState) {
    const { dist, parent, states, solved, overflow, par } = bfsResult(level, startState);
    if (!solved) return { solvable: false, par: null, overflow };
    const path = [];
    let k = solved;
    while (k && parent.has(k)) {
      const [prev, runIdx] = parent.get(k);
      path.push({ runIdx, from: states.get(prev), to: states.get(k) });
      k = prev;
    }
    path.reverse();
    return { solvable: true, par: par ?? dist.get(solved), path, solvedState: states.get(solved), overflow };
  }

  function solve(level, startState) {
    return solutionPath(level, startState);
  }
  // Re-export under new name for convenience

  // Hint: minimal-taps next move from the player's current state.
  function hintStep(level, currentState) {
    const res = solutionPath(level, currentState);
    if (!res.solvable) return null;
    return res.path[0] || null; // null means already solved
  }

  return {
    DIRS, DIR_INDEX, DIR_NAMES, COLOR_HEX,
    buildLevel, pieceAt, trace,
    stateKey, applyTap, isSolved, hintStep,
    solve,
  };
});
