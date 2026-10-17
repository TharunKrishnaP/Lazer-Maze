/* Laser Maze — tiny WebAudio synth: no asset files, everything generated. */
(function (root) {
  'use strict';

  let ctx = null;
  let master = null;
  let muted = false;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
    } catch (e) { return false; }
    return true;
  }

  function resume() {
    if (ensure() && ctx.state === 'suspended') ctx.resume();
  }

  function setMuted(m) { muted = m; }

  // basic shaped oscillator blip
  function tone(freq, dur, { type = 'sine', gain = 0.5, attack = 0.005, when = 0, slide = 0 } = {}) {
    if (muted || !ensure()) return;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  // filtered noise burst (for ticks / whoosh)
  function noise(dur, { freq = 2000, gain = 0.3, q = 1, when = 0, type = 'bandpass' } = {}) {
    if (muted || !ensure()) return;
    const t0 = ctx.currentTime + when;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t0);
  }

  const sfx = {
    rotate(state) {
      noise(0.06, { freq: 1800 + (state || 0) * 400, q: 4, gain: 0.25 });
      tone(320 + (state || 0) * 60, 0.09, { type: 'triangle', gain: 0.22 });
    },
    targetLit(colorIdx) {
      const base = 523 * Math.pow(2, (colorIdx % 8) / 12);
      tone(base, 0.28, { type: 'sine', gain: 0.4 });
      tone(base * 1.5, 0.24, { type: 'sine', gain: 0.18, when: 0.02 });
    },
    targetLost() {
      tone(220, 0.15, { type: 'sine', gain: 0.15, slide: -80 });
    },
    undo() {
      tone(300, 0.14, { type: 'triangle', gain: 0.25, slide: -140 });
    },
    reset() {
      noise(0.2, { freq: 700, q: 0.8, gain: 0.2, type: 'lowpass' });
      tone(180, 0.18, { type: 'triangle', gain: 0.15 });
    },
    hint() {
      tone(880, 0.12, { type: 'sine', gain: 0.2 });
      tone(1174, 0.16, { type: 'sine', gain: 0.2, when: 0.08 });
    },
    win() {
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
      notes.forEach((f, i) => tone(f, 0.35, { type: 'sine', gain: 0.3, when: i * 0.09 }));
      tone(1568, 0.6, { type: 'sine', gain: 0.22, when: notes.length * 0.09 });
    },
    // set finale (L10·20·30·40): rising two-voice fanfare with a sparkle tail
    finale() {
      const notes = [392, 523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, i) => {
        tone(f, 0.3, { type: 'sine', gain: 0.3, when: i * 0.1 });
        tone(f, 0.22, { type: 'triangle', gain: 0.16, when: i * 0.1 + 0.02 });
      });
      tone(1568, 0.8, { type: 'sine', gain: 0.25, when: 0.55 });
      noise(0.5, { freq: 6000, q: 0.5, gain: 0.06, when: 0 });
    },
    // game complete (L50): long full-spectrum arpeggio + octave shimmer
    complete() {
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98, 2093];
      notes.forEach((f, i) => tone(f, 0.5, { type: 'sine', gain: 0.28, when: i * 0.12 }));
      notes.forEach((f, i) => tone(f / 2, 0.5, { type: 'triangle', gain: 0.14, when: i * 0.12 }));
      noise(1.6, { freq: 5200, q: 0.4, gain: 0.05, when: 0.3 });
      tone(2637, 1.2, { type: 'sine', gain: 0.2, when: 0.9 });
    },
    ui() { tone(600, 0.06, { type: 'triangle', gain: 0.12 }); },
    locked() { tone(160, 0.12, { type: 'square', gain: 0.08 }); },
  };

  root.LaserAudio = { sfx, resume, setMuted };
})(typeof self !== 'undefined' ? self : this);
