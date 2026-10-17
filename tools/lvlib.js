/* Shared helpers for the level-tool suite: parse js/levels.js defs into plain
 * object lists, serialize them back to factory tokens, and rewrite an
 * individual level's `objects:` line in place. Used by destub.js and declump.js.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const LEVELS_PATH = path.join(__dirname, '..', 'js', 'levels.js');
const DIRS = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const DIRNAMES = ['N', 'E', 'S', 'W'];
const PERP = { N: ['E', 'W'], E: ['N', 'S'], S: ['E', 'W'], W: ['N', 'S'] };

function parseArgs(s) {
  return s.split(',').map(a => a.trim().replace(/'/g, ''));
}

function evalObjects(id, inner) {
  const objs = [];
  const re = /(E|T|M|P|FX|WALL|S|Z)\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(inner)) !== null) {
    const a = parseArgs(m[2]);
    switch (m[1]) {
      case 'E': objs.push({ t: 'emitter', x: +a[0], y: +a[1], dir: a[2], color: a[3] }); break;
      case 'T': objs.push({ t: 'target', x: +a[0], y: +a[1], color: a[2] }); break;
      case 'M': objs.push({ t: 'mirror', x: +a[0], y: +a[1], orient: +a[2] }); break;
      case 'P': objs.push({ t: 'prism', x: +a[0], y: +a[1], orient: +a[2] }); break;
      case 'FX': objs.push({ t: 'fixed', x: +a[0], y: +a[1], orient: +a[2] }); break;
      case 'WALL': objs.push({ t: 'wall', x: +a[0], y: +a[1] }); break;
      case 'S': objs.push({ t: 'splitter', x: +a[0], y: +a[1], orient: +a[2] }); break;
      case 'Z': objs.push({ t: 'filter', x: +a[0], y: +a[1], color: a[2] }); break;
    }
  }
  return objs;
}

function tok(o) {
  switch (o.t) {
    case 'emitter': return `E(${o.x}, ${o.y}, '${o.dir}', '${o.color}')`;
    case 'target': return `T(${o.x}, ${o.y}, '${o.color}')`;
    case 'mirror': return `M(${o.x}, ${o.y}, ${o.orient})`;
    case 'prism': return `P(${o.x}, ${o.y}, ${o.orient})`;
    case 'fixed': return `FX(${o.x}, ${o.y}, ${o.orient})`;
    case 'wall': return `WALL(${o.x}, ${o.y})`;
    case 'splitter': return `S(${o.x}, ${o.y}, ${o.orient})`;
    case 'filter': return `Z(${o.x}, ${o.y}, '${o.color}')`;
  }
  throw new Error('unknown piece type ' + o.t);
}

/** Parse every level def from the file: { id, dirLine, objectsLine, size, wh, spawnRaw, note, objects } */
function loadLevels() {
  const lines = fs.readFileSync(LEVELS_PATH, 'utf8').split('\n');
  const levels = [];
  for (let i = 0; i < lines.length; i++) {
    const mid = lines[i].match(/id:\s*(\d+),/);
    if (!mid) continue;
    const id = +mid[1];
    const lvl = { id, dirLine: i, size: null, sizeLine: -1, spawnRaw: null, note: '', objectsLine: -1 };
    for (let j = i; j < Math.min(i + 6, lines.length); j++) {
      const ms = lines[j].match(/size:\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/);
      if (ms) { lvl.size = [+ms[1], +ms[2]]; lvl.sizeLine = j; }
      const msp = lines[j].match(/spawn:\s*(null|\[[^\]]*\])/);
      if (msp) lvl.spawnRaw = msp[1];
      if (/objects:\s*\[/.test(lines[j])) { lvl.objectsLine = j; break; }
    }
    if (lvl.objectsLine < 0) throw new Error(`L${id}: objects line not found`);
    lvl.objects = evalObjects(id, lines[lvl.objectsLine].match(/objects:\s*\[(.*)\]/)[1]);
    lvl.wh = lvl.size ? lvl.size : (id >= 21 ? [9, 9] : [8, 8]);
    levels.push(lvl);
  }
  return { lines, levels, LEVELS_PATH };
}

/** build an engine def from a parsed level (spawn required explicitly when needed) */
function makeDef(lvl, objects, spawn) {
  const d = { id: lvl.id, note: lvl.note, objects: objects || lvl.objects, size: lvl.wh };
  if (spawn !== undefined) d.spawn = spawn;
  return d;
}

function valueOfSpawn(lvl) {
  return lvl.spawnRaw && lvl.spawnRaw !== 'null' ? JSON.parse(lvl.spawnRaw) : null;
}

/** serialize an object list and stage it into the pending lines array */
function saveObjects(lines, lvl, objects) {
  lines[lvl.objectsLine] = `      objects: [ ${objects.map(tok).join(', ')} ],`;
}

function cheb(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

module.exports = { LEVELS_PATH, DIRS, DIRNAMES, PERP, evalObjects, tok, loadLevels, valueOfSpawn, saveObjects, makeDef, cheb };
