/* Laser Maze — progress + settings state (session-only).
 * Nothing persists between visits: every page load starts a fresh run with
 * progress back at Level 1, while progress/streaks/bests still behave normally
 * within the current visit. `data` is tracked via best-moves per level plus a
 * "clean solve" streak (no-hint solves, streak reset otherwise). */
(function (root) {
  'use strict';

  const KEY = 'laserMaze.save.v5';
  const DEFAULTS = { unlocked: 1, best: {}, streak: 0, bestStreak: 0, muted: false, seenIntro: false, msgCursor: 0 };

  let data = load();

  /* Progress resets every visit: storage is wiped at startup and never written,
   * so each page load begins a brand-new run (in-session progress still works). */
  function load() {
    try { root.localStorage && root.localStorage.removeItem(KEY); } catch (e) { /* private mode */ }
    return { unlocked: 1, best: {}, streak: 0, bestStreak: 0, muted: false, seenIntro: false, msgCursor: 0 };
  }

  function save() { /* nothing persists across visits by design */ }

  return (root.LaserStorage = {
    get data() { return data; },
    isUnlocked(id) { return id <= data.unlocked; },
    maxLevel() { return data.unlocked; },
    bestFor(id) { return data.best[id] || null; },
    clearedCount() { return Object.keys(data.best).length; },
    streak() { return data.streak; },
    bestStreak() { return data.bestStreak; },
    /** Record a clear. `clean` = no hints used (streak is move-independent). */
    completeLevel(id, moves, { clean = false } = {}) {
      const prevBest = data.best[id];
      let newBest = false;
      if (!prevBest || moves < prevBest) { data.best[id] = moves; newBest = true; }
      if (clean) data.streak += 1;
      else data.streak = 0;
      if (data.streak > data.bestStreak) data.bestStreak = data.streak;
      const next = Math.min(id + 1, 50);
      if (next > data.unlocked) data.unlocked = next;
      save();
      return { newBest, streak: data.streak, bestStreak: data.bestStreak, wasCleared: !!prevBest };
    },
    /** Next index into a rotating message pool — never repeats until the pool
     * has been exhausted, and it survives reloads. */
    nextMessage(total) {
      const i = data.msgCursor % total;
      data.msgCursor = (data.msgCursor + 1) % (total * 1000);
      save();
      return i;
    },
    setMuted(m) { data.muted = m; save(); },
    setSeenIntro() { data.seenIntro = true; save(); },
    reset() {
      data = { unlocked: 1, best: {}, streak: 0, bestStreak: 0, muted: false, seenIntro: false, msgCursor: 0 };
      save();
    },
  });
})(typeof self !== 'undefined' ? self : this);
