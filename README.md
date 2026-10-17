# Laser Maze

A neon laser-puzzle game: rotate mirrors to guide color-matched lasers into
every target. 50 handcrafted levels, sequential unlock, each verified solvable.
Zero dependencies — open it or serve it anywhere.

## How to play

- Tap a mirror (white bar) to rotate it 90°.
- Guide every laser into a target of its **own color**; wrong-color beams fizzle.
- Pieces: mirrors (rotate), fixed mirrors (bracketed), prisms (rotate 45°),
  splitters (reflect and pass through), filters (recolor beams), walls (block).
- Beams are always live — the board re-traces after every tap.
  No timer, no move counter.
- The ≡ icon (top-right, every screen) opens settings: sound on/off and
  progress reset. Extras in game: U undo · R reset · H hint · Esc to map.

## Files

```
index.html        entry page and layout
css/style.css     neon styling, animations, responsive rules
js/engine.js      beam tracing, rotation, solver
js/levels.js      all 50 level definitions + spawn states
js/render.js      canvas board drawing and effects
js/main.js        input wiring, game loop, level flow
js/ui.js          screens, level map, HUD, settings dock, toasts
js/storage.js     localStorage progress, streaks, bests
js/audio.js       Web Audio sound effects
tools/            dev scripts (validation, smoke tests, level design)
```
