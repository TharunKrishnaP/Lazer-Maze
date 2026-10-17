/* Laser Maze — master level list, v3.
 *
 * Every level was traced by hand and is verified by tools/validate.js (BFS over
 * rotation states = minimal-taps optimal solution, "par"), plus tools/design.js
 * which computes the HARDEST legal starting configuration for each level and
 * writes it into the `spawn` array below (start states are pre-computed offline
 * because the engine + game must stay dependency-free and file://-safe).
 *
 * Difficulty follows the CHAPTER structure — sets of 10, one colour tier per
 * set:
 *   Set 1 (1–10)  · 1 laser, pars 1→10      Set 2 (11–20)  · 2 lasers, pars 6→15
 *   Set 3 (21–30) · 3 lasers, pars 9→18     Set 4 (31–40)  · 4 lasers, pars 11→20
 *   Set 5 (41–50) · 5 lasers, pars 12→21
 * Inside a set the difficulty climbs level by level; each set's finale is its
 * peak, and every new set opens a little easier than the previous finale.
 *
 * Legend:
 *   E(x,y,'dir',color)  emitter; dir: 'N','E','S','W'
 *   T(x,y,color)        target — lights only for a beam of the SAME color
 *   M(x,y,o)            rotatable mirror, 90° tap; 0='/' 1='\'          (2 states)
 *   P(x,y,o)            prism mirror, 45° tap; 0='/' 1='|'  2='\'  3='—'  (block states 1,3)
 *   FX(x,y,o)           fixed mirror (never rotates)
 *   WALL(x,y)           wall — absorbs
 *   S(x,y,o)            beam splitter (rotatable; reflect + transmit)
 *   Z(x,y,color)        color filter — recolors any beam passing through
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LaserLevels = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const E = (x, y, dir, color) => ({ t: 'emitter', x, y, dir, color });
  const T = (x, y, color) => ({ t: 'target', x, y, color });
  const M = (x, y, orient) => ({ t: 'mirror', x, y, orient });
  const P = (x, y, orient) => ({ t: 'prism', x, y, orient });
  const FX = (x, y, orient) => ({ t: 'fixed', x, y, orient });
  const WALL = (x, y) => ({ t: 'wall', x, y });
  const S = (x, y, orient) => ({ t: 'splitter', x, y, orient });
  const Z = (x, y, color) => ({ t: 'filter', x, y, color });

  const LEVELS = [
    // SET 1 · one laser (1–10, pars 1→10): mirrors only, learn to rotate
    {
      id: 1, note: 'Tap the mirror to rotate it. Guide the red beam into its target.',
      spawn: [1],
      objects: [ E(0, 5, 'E', 'red'), M(5, 5, 1), T(5, 1, 'red') ],
    },
    {
      id: 2, note: 'Two mirrors now. Line them both up.',
      spawn: [1, 1],
      objects: [ E(0, 6, 'E', 'green'), M(3, 6, 1), M(3, 2, 1), T(6, 2, 'green') ],
    },
    {
      id: 3, note: 'A longer chain — every mirror counts.',
      spawn: [0, 0, 1],
      objects: [ E(0, 0, 'S', 'blue'), M(0, 3, 0), M(3, 3, 0), M(3, 6, 1), T(0, 6, 'blue') ],
    },
    {
      id: 4, note: 'The bracketed mirror is FIXED — it never turns. Bounce off it.',
      spawn: [1, 1],
      objects: [ E(0, 6, 'E', 'magenta'), FX(3, 6, 0), P(3, 3, 1), M(5, 3, 1), T(5, 0, 'magenta') ],
    },
    {
      id: 5, note: 'Walls swallow light. Go around them.',
      spawn: [2, 1],
      objects: [ E(0, 2, 'E', 'cyan'), WALL(5, 2), P(2, 2, 1), P(2, 0, 1), T(7, 0, 'cyan') ],
    },

    // set 1 · prism fake-outs join the mix
    {
      id: 6, note: 'The fixed mirror adds a second bend for free.',
      spawn: [1, 3],
      objects: [ E(0, 6, 'E', 'orange'), P(2, 6, 1), FX(2, 3, 0), P(5, 3, 0), T(5, 6, 'orange') ],
    },
    {
      id: 7, note: 'A beam that doubles back on itself.',
      spawn: [1, 1, 0],
      objects: [ E(0, 7, 'E', 'yellow'), P(1, 7, 1), P(1, 1, 0), M(2, 1, 0), T(2, 4, 'yellow') ],
    },
    {
      id: 8, note: 'Shoot from the right edge. Left is home.',
      spawn: [1, 0, 1],
      objects: [ E(7, 2, 'W', 'purple'), P(4, 2, 1), P(4, 6, 0), P(6, 6, 0), T(6, 5, 'purple') ],
    },
    {
      id: 9, note: 'U-turns are the bread and butter of light.',
      spawn: [1, 1, 3],
      objects: [ E(0, 3, 'E', 'green'), P(3, 3, 1), P(3, 1, 0), P(6, 1, 0), T(6, 4, 'green') ],
    },
    {
      id: 10, note: 'Last easy set. Four mirrors, one wall, no mercy.',
      spawn: [1, 1, 3, 1],
      objects: [ E(0, 7, 'E', 'cyan'), P(2, 7, 1), P(2, 1, 1), P(5, 1, 0), M(5, 6, 1), WALL(7, 1), T(3, 6, 'cyan') ],
    },

    // SET 2 · two lasers (11–20, pars 6→15): prisms everywhere, a second beam arrives
    {
      id: 11, note: 'A second laser wakes up. Guide each colour to its own targets.',
      spawn: [3, 1, 0, 0, 0, 0],
      objects: [ E(0, 7, 'E', 'blue'), P(2, 7, 1), P(2, 2, 1), M(6, 2, 0), T(6, 6, 'blue'), E(3, 7, 'E', 'green'), M(7, 7, 0), M(7, 1, 1), M(1, 1, 0), T(1, 2, 'green') ],
    },
    {
      id: 12, note: 'NEW: Prisms turn 45° per tap and can BLOCK the beam sideways.',
      spawn: [2, 1, 0, 0, 0],
      objects: [ E(0, 4, 'E', 'yellow'), P(4, 4, 3), P(4, 1, 1), T(7, 1, 'yellow'), E(4, 5, 'E', 'blue'), M(7, 5, 1), M(7, 6, 0), M(1, 6, 1), T(1, 5, 'blue') ],
    },
    {
      id: 13, note: 'That prism is cutting the beam. Rotate it into an angle that works.',
      spawn: [3, 0, 0, 0, 0, 0, 0, 0],
      objects: [ E(0, 4, 'E', 'magenta'), P(3, 4, 2), M(3, 6, 1), M(6, 6, 0), M(6, 1, 1), M(4, 1, 1), T(4, 0, 'magenta'), E(1, 3, 'W', 'cyan'), M(0, 3, 1), M(0, 2, 0), M(4, 2, 1), T(4, 3, 'cyan') ],
    },
    {
      id: 14, note: 'Two prisms, two block states to dodge.',
      spawn: [1, 1, 0, 1, 0, 0],
      objects: [ E(0, 7, 'E', 'cyan'), P(2, 7, 2), P(2, 2, 1), M(5, 2, 0), T(5, 7, 'cyan'), E(6, 7, 'E', 'purple'), M(7, 7, 0), M(7, 1, 1), M(1, 1, 0), T(1, 2, 'purple') ],
    },
    {
      id: 15, note: 'A prism sits inside the run. Line it up or bust.',
      spawn: [1, 1, 0, 1, 0, 1],
      objects: [ E(0, 6, 'E', 'blue'), P(2, 6, 1), P(2, 2, 2), M(5, 2, 0), T(5, 5, 'blue'), E(0, 7, 'E', 'red'), M(7, 7, 0), M(7, 1, 1), M(1, 1, 0), T(1, 2, 'red') ],
    },

    // set 2 · multi-mirror marches
    {
      id: 16, note: 'Four mirrors march diagonally.',
      spawn: [1, 1, 1, 1, 0, 1, 0],
      objects: [ E(7, 0, 'S', 'green'), P(7, 3, 0), P(5, 3, 0), M(5, 6, 0), M(2, 6, 1), T(2, 7, 'green'), E(2, 2, 'N', 'orange'), M(2, 0, 1), M(1, 0, 0), M(1, 5, 1), T(2, 5, 'orange') ],
    },
    {
      id: 17, note: 'Prism chains — each block state is a deadlock.',
      spawn: [1, 1, 1, 0, 1, 0],
      objects: [ E(0, 3, 'E', 'purple'), P(3, 3, 1), P(3, 1, 1), P(5, 1, 1), T(5, 0, 'purple'), E(4, 5, 'E', 'yellow'), M(7, 5, 1), M(7, 6, 0), M(1, 6, 1), T(1, 5, 'yellow') ],
    },
    {
      id: 18, note: 'A drop, a rise, a drop again.',
      spawn: [3, 1, 1, 0, 1, 0, 1],
      objects: [ E(0, 0, 'S', 'green'), P(0, 6, 0), P(4, 6, 1), P(4, 2, 0), M(6, 2, 1), T(6, 5, 'green'), E(0, 7, 'E', 'magenta'), M(7, 7, 0), M(7, 1, 1), M(3, 1, 0), T(3, 2, 'magenta') ],
    },
    {
      id: 19, note: 'A prism chain — every block state is a dead end.',
      spawn: [3, 3, 1, 0, 1],
      objects: [ E(0, 4, 'E', 'blue'), P(4, 4, 2), P(4, 7, 1), P(5, 7, 0), T(5, 0, 'blue'), E(0, 0, 'S', 'orange'), P(0, 3, 1), P(3, 3, 0), T(3, 2, 'orange') ],
    },
    {
      id: 20, note: 'Chapter close. Mixed kit, one winding lane.',
      spawn: [1, 1, 1, 3, 1, 0, 1],
      objects: [ E(0, 7, 'E', 'orange'), P(1, 7, 1), P(1, 4, 1), FX(4, 4, 0), P(4, 1, 1), P(7, 1, 1), T(7, 6, 'orange'), E(4, 5, 'W', 'blue'), M(2, 5, 0), M(2, 6, 1), M(5, 6, 0), T(5, 2, 'blue') ],
    },

    // SET 3 · three lasers (21–30, pars 9→18): splitters & colour filters return
    {
      id: 21, note: 'A third beam joins. Same rules — every colour finds its own light.',
      spawn: [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      objects: [ E(0, 0, 'S', 'yellow'), P(0, 2, 1), P(2, 2, 1), M(2, 5, 1), M(5, 5, 1), M(5, 8, 1), T(8, 8, 'yellow'), E(7, 3, 'E', 'red'), M(8, 3, 1), M(8, 4, 0), M(4, 4, 1), T(4, 3, 'red'), E(2, 6, 'E', 'blue'), M(4, 6, 1), M(4, 7, 0), M(1, 7, 1), T(1, 3, 'blue') ],
    },
    {
      id: 22, note: 'Two lasers that secretly share a mirror.',
      spawn: [0, 0, 0, 1, 0, 0, 0, 0],
      objects: [ E(0, 0, 'S', 'red'), E(0, 8, 'N', 'blue'), P(0, 2, 1), P(2, 2, 1), M(2, 5, 1), P(5, 5, 0), T(5, 0, 'red'), M(0, 5, 1), T(2, 8, 'blue'), E(7, 6, 'E', 'green'), M(8, 6, 1), M(8, 7, 0), M(4, 7, 1), T(4, 6, 'green') ],
    },
    {
      id: 23, note: 'Prisms and splitters carry both colors. Both must land true.',
      spawn: [0, 1, 0, 1, 0, 0, 0],
      objects: [ E(0, 4, 'E', 'red'), S(2, 4, 1), T(2, 7, 'red'), T(3, 2, 'red'), P(5, 4, 0), P(5, 2, 1), E(8, 0, 'S', 'blue'), P(8, 2, 0), T(5, 0, 'blue'), E(7, 6, 'E', 'yellow'), M(8, 6, 1), M(8, 7, 0), M(4, 7, 1), T(4, 6, 'yellow') ],
    },
    {
      id: 24, note: 'Splitters + a filter: three lanes out of one beam.',
      spawn: [0, 0, 3, 3, 0, 0, 0, 0],
      objects: [ E(0, 0, 'S', 'red'), S(0, 2, 1), S(0, 3, 1), P(2, 2, 1), P(2, 5, 2), P(0, 5, 1), Z(5, 5, 'green'), T(8, 5, 'green'), T(2, 8, 'red'), T(8, 3, 'red'), E(5, 0, 'E', 'blue'), M(8, 0, 1), M(8, 1, 0), M(2, 1, 1), T(2, 0, 'blue') ],
    },
    {
      id: 25, note: 'Vertical traffic. Watch the crossings.',
      spawn: [3, 3, 1, 0, 0, 0, 0, 1, 0],
      objects: [ E(4, 8, 'N', 'red'), P(4, 6, 1), P(2, 6, 1), M(2, 2, 0), M(7, 2, 1), E(0, 0, 'S', 'blue'), M(0, 3, 1), M(6, 3, 1), T(7, 8, 'red'), T(6, 8, 'blue'), E(5, 0, 'E', 'green'), M(8, 0, 1), M(8, 1, 0), M(2, 1, 1), T(2, 0, 'green') ],
    },

    // set 3 · wrap-around snakes
    {
      id: 26, note: 'A snake of six mirrors, corner to corner.',
      spawn: [3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      objects: [ E(0, 0, 'S', 'cyan'), P(0, 2, 1), P(2, 2, 1), P(2, 5, 1), M(4, 5, 1), M(4, 8, 1), M(7, 8, 1), T(7, 0, 'cyan'), E(6, 3, 'N', 'red'), M(6, 0, 1), M(5, 0, 0), M(5, 6, 1), T(6, 6, 'red'), E(2, 6, 'E', 'yellow'), M(3, 6, 1), M(3, 7, 0), M(1, 7, 1), T(1, 3, 'yellow') ],
    },
    {
      id: 27, note: 'Seven mirrors this time. Do not lose the thread.',
      spawn: [3, 3, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0],
      objects: [ E(0, 0, 'S', 'magenta'), P(0, 2, 1), P(2, 2, 1), M(2, 5, 1), M(4, 5, 1), M(4, 8, 1), M(7, 8, 1), M(7, 3, 1), T(0, 3, 'magenta'), E(5, 0, 'E', 'green'), M(8, 0, 1), M(8, 1, 0), M(2, 1, 1), T(2, 0, 'green'), E(3, 8, 'W', 'blue'), M(0, 8, 1), M(0, 5, 0), T(1, 5, 'blue') ],
    },
    {
      id: 28, note: 'The splitter forks the snake — light both ends.',
      spawn: [3, 3, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1],
      objects: [ E(0, 0, 'S', 'yellow'), P(0, 2, 1), P(2, 2, 1), M(2, 5, 1), S(4, 5, 1), M(4, 8, 1), M(7, 8, 1), M(7, 3, 1), T(0, 3, 'yellow'), T(8, 5, 'yellow'), E(5, 0, 'E', 'red'), M(8, 0, 1), M(8, 1, 0), M(2, 1, 1), T(2, 0, 'red'), E(3, 8, 'W', 'cyan'), M(0, 8, 1), M(0, 5, 0), T(1, 5, 'cyan') ],
    },
    {
      id: 29, note: 'Two lasers chase each other, clockwise.',
      spawn: [3, 3, 3, 3, 0, 1, 0, 0, 0, 0],
      objects: [ E(0, 0, 'S', 'red'), E(8, 8, 'N', 'blue'), P(0, 2, 1), P(2, 2, 1), P(2, 5, 1), P(4, 5, 1), M(4, 8, 1), M(7, 8, 1), M(8, 5, 1), T(7, 0, 'red'), T(4, 0, 'blue'), E(2, 6, 'E', 'purple'), M(3, 6, 1), M(3, 7, 0), M(1, 7, 1), T(1, 3, 'purple') ],
    },
    {
      id: 30, note: 'Prisms corner the snake. It bites its tail.',
      spawn: [3, 3, 0, 0, 3, 1, 0, 1, 0, 0, 1, 0],
      objects: [ E(0, 0, 'S', 'orange'), P(0, 2, 1), P(2, 2, 2), M(2, 5, 1), M(4, 5, 1), P(4, 8, 0), M(7, 8, 1), T(7, 0, 'orange'), E(6, 3, 'N', 'green'), M(6, 0, 1), M(5, 0, 0), M(5, 6, 1), T(6, 6, 'green'), E(2, 6, 'E', 'blue'), M(3, 6, 1), M(3, 7, 0), M(1, 7, 1), T(1, 3, 'blue') ],
    },

    // SET 4 · four lasers (31–40, pars 11→20): interlocked chains
    {
      id: 31, note: 'Four lasers share one maze. Plan green before you commit red.',
      spawn: [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      objects: [ E(0, 0, 'S', 'cyan'), P(0, 2, 1), P(2, 2, 1), M(2, 4, 1), M(4, 4, 1), M(4, 6, 1), M(6, 6, 1), M(6, 8, 1), M(8, 8, 0), T(8, 0, 'cyan'), E(5, 0, 'E', 'red'), M(7, 0, 1), M(7, 1, 0), M(2, 1, 1), T(2, 0, 'red'), E(0, 3, 'S', 'green'), M(0, 8, 1), M(4, 8, 0), T(4, 7, 'green'), E(3, 2, 'E', 'blue'), M(6, 2, 1), T(6, 3, 'blue') ],
    },
    {
      id: 32, note: 'A prism inside the weave, red and blue braided.',
      spawn: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      objects: [ E(0, 0, 'S', 'red'), E(8, 8, 'N', 'blue'), P(0, 2, 1), P(2, 2, 2), P(2, 5, 1), M(4, 5, 1), M(4, 8, 1), M(7, 8, 1), M(8, 5, 1), T(7, 0, 'red'), T(4, 0, 'blue'), E(2, 6, 'E', 'green'), M(3, 6, 1), M(3, 7, 0), M(1, 7, 1), T(1, 3, 'green'), E(5, 0, 'E', 'purple'), M(6, 0, 1), M(6, 3, 0), T(5, 3, 'purple') ],
    },
    {
      id: 33, note: 'Three lasers, three routes, one picture.',
      spawn: [3, 3, 3, 0, 0, 0, 0, 0, 0, 0],
      objects: [ E(0, 0, 'S', 'red'), P(0, 3, 1), P(3, 3, 2), P(3, 6, 1), T(6, 6, 'red'), E(0, 8, 'N', 'green'), M(0, 5, 1), M(7, 5, 1), T(7, 8, 'green'), E(8, 0, 'S', 'blue'), M(8, 4, 0), M(2, 4, 1), T(2, 0, 'blue'), E(2, 8, 'W', 'purple'), M(1, 8, 1), M(1, 7, 0), M(5, 7, 1), T(5, 8, 'purple') ],
    },
    {
      id: 34, note: 'Every mirror works for two colors at once.',
      spawn: [1, 3, 0, 1, 1, 0, 0, 1],
      objects: [ E(4, 8, 'N', 'red'), S(4, 5, 0), P(6, 5, 0), S(4, 3, 0), T(6, 8, 'red'), T(0, 3, 'red'), M(4, 2, 0), T(5, 2, 'red'), E(0, 8, 'N', 'blue'), P(0, 4, 1), P(3, 4, 2), T(3, 8, 'blue'), E(8, 8, 'N', 'green'), P(8, 5, 1), FX(6, 1, 0), T(8, 1, 'green'), E(8, 0, 'W', 'orange'), M(5, 0, 0), T(5, 1, 'orange') ],
    },
    {
      id: 35, note: 'The prism gets woven into a three-color braid.',
      spawn: [1, 3, 0, 1, 1, 1, 0, 0, 0, 0],
      objects: [ E(4, 8, 'N', 'red'), S(4, 5, 0), P(6, 5, 0), S(4, 3, 0), T(6, 8, 'red'), T(0, 3, 'red'), M(4, 2, 0), T(5, 2, 'red'), E(0, 8, 'N', 'blue'), P(0, 4, 1), P(2, 4, 3), M(2, 2, 0), T(1, 2, 'blue'), E(8, 8, 'N', 'green'), M(8, 5, 1), FX(6, 1, 0), T(8, 1, 'green'), E(1, 8, 'E', 'yellow'), M(3, 8, 0), M(3, 5, 1), T(2, 5, 'yellow') ],
    },

    // set 4 · loops and long braids
    {
      id: 36, note: 'Three colors, three chains, no shortcuts.',
      spawn: [3, 3, 3, 0, 1, 0, 0, 0, 1, 0],
      objects: [ E(0, 0, 'S', 'red'), P(0, 2, 1), P(2, 2, 1), P(2, 5, 1), M(4, 5, 1), M(4, 8, 0), T(2, 8, 'red'), E(8, 8, 'N', 'blue'), M(8, 5, 1), M(5, 5, 1), T(5, 0, 'blue'), E(8, 1, 'W', 'green'), M(3, 1, 1), T(3, 0, 'green'), E(1, 3, 'W', 'purple'), M(0, 3, 0), M(0, 7, 1), T(1, 7, 'purple') ],
    },
    {
      id: 37, note: 'Prisms all the way down. Green rides the fixed lane.',
      spawn: [3, 3, 3, 0, 3, 1, 0, 0, 0, 0],
      objects: [ E(0, 0, 'S', 'red'), P(0, 3, 1), P(3, 3, 2), P(3, 6, 2), S(6, 6, 1), P(6, 8, 1), T(8, 8, 'red'), E(0, 8, 'N', 'green'), M(0, 6, 0), T(3, 8, 'green'), E(5, 1, 'N', 'blue'), M(5, 0, 1), M(4, 0, 0), M(4, 4, 1), T(5, 4, 'blue'), E(1, 1, 'E', 'orange'), M(2, 1, 1), T(2, 4, 'orange') ],
    },
    {
      id: 38, note: 'Three emitters, three colors, one tangled weave.',
      spawn: [3, 0, 3, 3, 3, 1, 0, 0, 0],
      objects: [ E(0, 0, 'S', 'red'), E(8, 2, 'W', 'blue'), E(0, 8, 'N', 'green'), P(0, 2, 1), S(2, 2, 1), P(2, 5, 1), P(5, 5, 2), P(5, 8, 2), P(0, 5, 0), T(8, 8, 'red'), T(2, 0, 'blue'), T(2, 8, 'green'), E(6, 5, 'S', 'magenta'), M(6, 7, 1), M(7, 7, 0), M(7, 4, 1), T(3, 4, 'magenta') ],
    },
    {
      id: 39, note: 'A big-board loop with prisms and a splitter.',
      spawn: [3, 3, 3, 1, 0, 0, 1, 0, 1, 1, 0],
      objects: [ E(0, 0, 'S', 'purple'), P(0, 2, 1), P(2, 2, 1), P(2, 5, 2), S(5, 5, 1), P(5, 8, 2), M(7, 8, 1), P(7, 5, 2), S(6, 5, 1), T(5, 3, 'purple'), T(7, 0, 'purple'), T(6, 8, 'purple'), E(5, 7, 'W', 'red'), P(0, 7, 0), T(0, 8, 'red'), E(8, 0, 'S', 'green'), M(8, 7, 0), T(7, 7, 'green'), E(1, 0, 'E', 'cyan'), M(4, 0, 1), T(4, 1, 'cyan') ],
    },
    {
      id: 40, note: 'Two prisms turn one lane into three missions.',
      spawn: [3, 3, 3, 3, 1, 3, 1, 0, 0],
      objects: [ E(0, 0, 'S', 'red'), P(0, 2, 1), P(3, 2, 2), P(3, 5, 1), P(5, 5, 2), T(5, 8, 'red'), E(8, 0, 'S', 'blue'), P(8, 3, 0), P(2, 3, 1), T(2, 0, 'blue'), E(0, 8, 'N', 'green'), M(0, 5, 0), T(3, 8, 'green'), E(8, 8, 'N', 'yellow'), M(8, 4, 1), M(6, 4, 0), T(6, 5, 'yellow') ],
    },

    // SET 5 · five lasers (41–50, pars 12→21): the full spectrum
    {
      id: 41, note: 'Five lasers — the full spectrum rides at once.',
      spawn: [3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      objects: [ E(0, 0, 'S', 'red'), P(0, 3, 1), P(3, 3, 1), M(3, 6, 1), T(6, 6, 'red'), E(0, 8, 'N', 'green'), M(0, 5, 1), M(7, 5, 1), T(7, 8, 'green'), E(8, 0, 'S', 'blue'), M(8, 4, 0), P(2, 4, 2), T(2, 0, 'blue'), E(2, 8, 'W', 'yellow'), M(1, 8, 1), M(1, 7, 0), M(5, 7, 1), T(5, 8, 'yellow'), E(7, 3, 'N', 'orange'), M(7, 0, 1), M(4, 0, 0), T(4, 1, 'orange') ],
    },
    {
      id: 42, note: 'A grand tour of the big board, both colors riding rails.',
      spawn: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], size: [10, 10],
      objects: [ E(0, 0, 'S', 'red'), P(0, 2, 1), P(2, 2, 2), P(2, 5, 1), M(4, 5, 1), P(4, 8, 2), T(9, 8, 'red'), E(9, 0, 'S', 'blue'), M(9, 5, 0), T(4, 0, 'blue'), E(0, 7, 'S', 'green'), M(0, 9, 1), M(1, 9, 0), M(1, 4, 1), T(0, 4, 'green'), E(5, 0, 'E', 'yellow'), M(8, 0, 1), M(8, 3, 0), T(7, 3, 'yellow'), E(1, 0, 'E', 'magenta'), M(3, 0, 1), T(3, 3, 'magenta') ],
    },
    {
      id: 43, note: 'Green loops the floor, blue rides the top rail.',
      spawn: [0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      objects: [ E(0, 0, 'S', 'green'), S(1, 2, 1), T(1, 5, 'green'), S(3, 5, 1), T(3, 8, 'green'), P(0, 2, 2), P(2, 2, 2), P(2, 5, 2), S(4, 5, 1), P(4, 8, 2), M(7, 8, 1), S(7, 5, 1), T(4, 0, 'green'), T(7, 0, 'green'), E(8, 8, 'N', 'blue'), M(8, 7, 1), T(5, 7, 'blue'), E(5, 0, 'E', 'red'), P(6, 0, 1), T(6, 3, 'red'), E(2, 0, 'S', 'orange'), M(2, 1, 1), T(5, 1, 'orange'), E(0, 3, 'S', 'purple'), M(0, 4, 1), T(3, 4, 'purple') ],
    },
    {
      id: 44, note: 'The prism feeds both sides of the room.',
      spawn: [1, 3, 0, 0, 1, 0, 0, 1, 0, 0, 0],
      objects: [ E(4, 8, 'N', 'red'), S(4, 5, 1), P(6, 5, 0), S(4, 3, 0), T(6, 8, 'red'), T(0, 3, 'red'), M(4, 2, 1), T(3, 2, 'red'), E(0, 8, 'N', 'blue'), M(0, 4, 1), M(3, 4, 0), T(3, 8, 'blue'), E(8, 8, 'N', 'green'), P(8, 5, 2), P(6, 2, 3), T(8, 2, 'green'), E(5, 4, 'N', 'yellow'), M(5, 0, 0), M(7, 0, 1), T(7, 1, 'yellow'), E(0, 0, 'E', 'cyan'), M(3, 0, 1), T(3, 1, 'cyan') ],
    },
    {
      id: 45, note: 'A prism staircase and a summit shot. Precision, please.',
      spawn: [3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], size: [10, 10],
      objects: [ E(0, 0, 'S', 'magenta'), P(0, 2, 2), P(2, 2, 2), P(2, 5, 2), S(5, 5, 1), P(5, 8, 2), M(7, 8, 1), T(7, 0, 'magenta'), T(9, 5, 'magenta'), E(0, 7, 'S', 'red'), M(0, 9, 1), M(1, 9, 0), M(1, 4, 1), T(0, 4, 'red'), E(3, 4, 'N', 'green'), M(3, 0, 1), T(2, 0, 'green'), E(8, 0, 'E', 'blue'), M(9, 0, 1), T(9, 3, 'blue'), E(8, 6, 'E', 'yellow'), M(9, 6, 1), T(9, 9, 'yellow') ],
    },

    // set 5 · the final gauntlet
    {
      id: 46, note: 'Double splitters, double wrap. Total recall.',
      spawn: [3, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1],
      objects: [ E(0, 0, 'S', 'cyan'), P(0, 2, 1), S(2, 2, 1), P(2, 5, 2), S(4, 5, 1), P(4, 8, 0), P(7, 8, 1), M(7, 5, 1), T(4, 3, 'cyan'), T(2, 0, 'cyan'), E(3, 8, 'W', 'red'), M(0, 8, 1), M(0, 4, 0), T(1, 4, 'red'), E(5, 3, 'E', 'green'), M(8, 3, 1), T(8, 4, 'green'), E(5, 0, 'E', 'blue'), M(8, 0, 1), T(8, 1, 'blue'), E(1, 0, 'S', 'purple'), M(1, 3, 0), T(0, 3, 'purple') ],
    },
    {
      id: 47, note: 'Ten by ten. A splitter braids three colors through one column.',
      spawn: [3, 3, 3, 0, 0, 3, 1, 0, 1, 0, 0], size: [10, 10],
      objects: [ E(0, 0, 'S', 'red'), P(0, 2, 1), P(2, 2, 2), P(2, 4, 1), S(2, 5, 1), M(5, 5, 1), P(5, 8, 2), M(0, 5, 0), T(9, 4, 'red'), E(9, 2, 'W', 'blue'), T(2, 0, 'blue'), E(0, 6, 'N', 'green'), T(2, 9, 'green'), T(9, 8, 'green'), E(3, 0, 'S', 'yellow'), M(3, 1, 1), M(8, 1, 0), T(8, 0, 'yellow'), E(9, 9, 'W', 'purple'), M(3, 9, 1), M(3, 7, 0), T(4, 7, 'purple') ],
    },
    {
      id: 48, note: 'Six targets, three lasers, one shared mirror.',
      spawn: [1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0], size: [10, 10],
      objects: [ E(5, 9, 'N', 'red'), S(5, 6, 1), P(7, 6, 0), S(5, 4, 0), T(7, 9, 'red'), T(1, 4, 'red'), M(5, 3, 1), T(4, 3, 'red'), E(1, 9, 'N', 'blue'), P(1, 5, 1), S(4, 5, 0), T(4, 9, 'blue'), T(8, 5, 'blue'), E(9, 9, 'N', 'green'), P(9, 6, 2), P(7, 2, 3), T(9, 2, 'green'), E(4, 0, 'W', 'cyan'), P(0, 0, 0), M(0, 3, 1), T(1, 3, 'cyan'), E(6, 4, 'N', 'orange'), M(6, 0, 0), M(8, 0, 1), T(8, 1, 'orange') ],
    },
    {
      id: 49, note: 'Three chains, two block prisms, one endgame.',
      spawn: [3, 3, 3, 0, 3, 1, 1, 0, 0, 0, 0, 0],
      objects: [ E(0, 0, 'S', 'red'), P(0, 3, 1), P(3, 3, 2), P(3, 6, 2), S(6, 6, 1), P(6, 8, 1), T(8, 8, 'red'), E(0, 8, 'N', 'green'), P(0, 5, 0), T(5, 5, 'green'), E(8, 0, 'S', 'blue'), M(8, 4, 0), M(2, 4, 1), T(2, 0, 'blue'), E(7, 3, 'N', 'yellow'), M(7, 0, 1), M(4, 0, 0), T(4, 1, 'yellow'), E(1, 6, 'S', 'purple'), M(1, 8, 1), M(4, 8, 0), T(4, 7, 'purple') ],
    },
    {
      id: 50, note: 'The final maze. Ten pieces of light, perfectly placed.',
      spawn: [3, 0, 3, 0, 3, 1, 0, 0, 0, 1, 0, 1, 0], size: [10, 10],
      objects: [ E(0, 0, 'S', 'red'), P(0, 2, 1), S(2, 2, 1), P(2, 5, 1), S(5, 5, 1), P(5, 8, 1), P(8, 8, 0), M(8, 5, 1), M(9, 4, 1), M(4, 4, 1), M(0, 5, 0), T(5, 0, 'red'), T(2, 0, 'red'), E(9, 9, 'N', 'blue'), T(4, 0, 'blue'), E(0, 6, 'N', 'green'), T(2, 9, 'green'), E(8, 9, 'W', 'cyan'), M(3, 9, 1), M(3, 7, 0), T(4, 7, 'cyan'), E(6, 0, 'E', 'orange'), M(9, 0, 1), T(9, 1, 'orange') ],
    },
  ];

  function withSize(level) {
    if (!level.w && !level.size) {
      level.w = level.id >= 21 ? 9 : 8;
      level.h = level.id >= 21 ? 9 : 8;
    }
    return level;
  }

  return {
    LEVELS: LEVELS.map(withSize),
    COLOR_HEX: {
      red: '#ff3b5c', green: '#3dfb7c', blue: '#38b6ff', yellow: '#ffd23b',
      magenta: '#ff5ce4', cyan: '#46f0e0', orange: '#ff8a3b', purple: '#9d6bff',
    },
  };
});
