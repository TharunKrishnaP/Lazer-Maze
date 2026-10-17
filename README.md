# Laser Maze

A neon laser-puzzle game. Rotate mirrors to guide lasers into color-matched
targets. 50 handcrafted levels in five **chapters of ten** — each chapter is a
color tier (1 laser → 5 lasers), difficulty**rises level by level within a
set** and each set's finale (levels 10/20/30/40/50) is its hardest board
(par 1 at level 1 up to 21 at the finale). Every level is verified solvable.
One animated nebula/neon theme throughout. Zero dependencies — open
`index.html` directly or serve the folder.

## Play

- Double-click `index.html` (works from `file://`), or
- `node tools\serve.js 8437` → http://localhost:8437

## How to play

- **Tap a mirror** (white bar) to rotate it 90°.
- Guide every laser into a target of its **own color**; wrong-color beams fizzle.
- Pieces: **mirrors** (rotate), **fixed mirrors** (bracketed), **prisms**
  (rotate 45°; `|` and `—` states block), **splitters** (reflect *and* pass
  through), **filters** (recolor a passing beam), **walls** (block).
- Beams are always live — the board re-traces after every tap. No timer.

## Scoring & progression

- Levels unlock sequentially; **no par and no move counter are ever shown** —
  the win card shows a short line of praise only.
- Difficulty ramp (optimal taps), strictly increasing inside each set and each
  set-finale being that set's peak: set 1 = 1→10, set 2 = 6→15, set 3 = 9→18,
  set 4 = 11→20, set 5 = 12→21.
- **Win messages rotate** through a pool of 12 short one-liners round-robin
  (position persists in the save), so consecutive clears never repeat and none
  of them reference move counts or sets.
- The 🔥 **streak** counts **consecutive no-hint solves** — deliberately not
  move-dependent. Any hint resets it; best streak persists.
- The ▾ ≡ **Settings** live in a single global three-bar icon (top-right on
  every screen) that opens an inline dock (sound on/off + reset progress)
  aligned beneath it; nothing navigates away and there is no separate settings
  screen or link.
- The title screen shows a **challenge quote** that sharpens as progress grows
  instead of level statistics.
- One visual theme. Progress + streaks persist in `localStorage`
  (`laserMaze.save.v5`).

Placement rule: no target is ever **pre-solved** — every feeding beam path
contains a rotatable piece, so no board starts with a target already lit — and
same-colour pieces are kept ≥ 3 cells apart (the few dense corner webs that
cannot reach 3 sit 2 apart, separated by an empty cell, and remain fully
solvable).

## Keys

`U`/`Z` undo · `R` reset · `H` hint · `Esc` back to map.

## Dev tools

- `node tools\validate.js` — verifies all 50 levels: bounds, duplicates,
  solvability, state-space size ≤ 262 144, computes par (BFS minimal taps).
  Prints a par table.
- `node tools\smoke.js` — headless end-to-end test: stubs the DOM, loads the
  real game scripts, solver-drives all 50 levels to a win, checks best-moves,
  no-hint streak rules, message rotation, unlock order, undo/reset, click
  regression and render frames.
- `node tools\design.js` — recomputes each level's starting state so its
  optimal tap count equals the exact ramp target (multi-source reverse BFS
  from the solved-state set) and writes `spawn: [...]` into `js/levels.js`.
- `node tools\beef.js` — auto-hardener: when a level's structure can't reach
  its ramp target, it tries every subset of mirror→prism conversions and
  writes back the smallest set that reaches the target. Manual redesigns only
  where this fails.
- `node tools\colour.js` — colour-tier enforcer: brings every level up to its
  chapter's laser count (2 lasers from L11, 3 from L21, 4 from L31, 5 from
  L41) by routing verified independent mini-chains (emitter → up to 3 mirrors
  → target) through cells no winning beam ever crosses; enforces the
  same-colour spacing rules above.
- `node tools\destub.js` — anti–pre-solved-target pass: any target fed by a
  beam path that lights it in *every* rotation state (straight stubs, or
  splitter-transmission chains) is re-anchored as
  emitter → rotatable mirror → target with the target ≥ 3 cells from every
  same-colour piece.
- `node tools\declump.js` — slides same-colour pieces ≥ 3 cells apart along
  their own beam lanes (with an upstream-bender group-move fallback); every
  candidate slide is verified to leave the level's par unchanged, so puzzles
  never shift difficulty.
- `node tools\lvlib.js` — shared levels.js parse/serialize helpers for the
  surgery tools.
- `node tools\strip.js` — removes previously appended colour chains
  (reverse of `colour.js`, geometry-verified) before re-running `colour.js`.
- `node tools\probe.js` — analyse a single inline level definition
  (depth, solution count).
- `node tools\serve.js [port]` — tiny static server for browser testing.

## Files

```
index.html        page shell
css/style.css     neon UI: aurora drift, glass panels, node pop-in
js/engine.js      grid, ray tracing, win check, BFS solver
js/levels.js      all 50 level definitions (grid 8×8 → 10×10)
js/render.js      canvas renderer: nebula space, starfield, glow beams,
                  particles, mirror tweens, ripples, win celebration
js/audio.js       WebAudio synth SFX
js/storage.js     localStorage progress (best moves, no-hint streak,
                  message-rotation cursor)
js/ui.js          screens, level map, HUD, win overlay + rotating praise
js/main.js        game loop + orchestration
```
