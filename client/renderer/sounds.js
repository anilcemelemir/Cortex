// Cortex UI sounds. Kept procedural so the app has no extra audio assets to ship.
(function () {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let ctx = null;
  let master = null;
  const lastPlayed = new Map();

  function getContext() {
    if (!AudioCtx) return null;
    if (!ctx) {
      ctx = new AudioCtx();
      master = ctx.createGain();
      master.gain.value = 0.18;
      master.connect(ctx.destination);
    }
    return ctx;
  }

  function unlock() {
    const audio = getContext();
    if (audio && audio.state === 'suspended') audio.resume().catch(() => {});
  }

  function tone(audio, { at = 0, freq = 440, to = null, duration = 0.12, gain = 0.5, type = 'sine' }) {
    const start = audio.currentTime + at;
    const osc = audio.createOscillator();
    const amp = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, start + duration);
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(gain, start + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(amp).connect(master);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  function play(name) {
    const audio = getContext();
    if (!audio) return;
    unlock();

    const now = performance.now();
    if (now - (lastPlayed.get(name) || 0) < 120) return;
    lastPlayed.set(name, now);

    if (name === 'message') {
      tone(audio, { freq: 740, to: 980, duration: 0.09, gain: 0.36, type: 'triangle' });
      tone(audio, { at: 0.075, freq: 1240, duration: 0.07, gain: 0.22, type: 'sine' });
      return;
    }
    if (name === 'join') {
      tone(audio, { freq: 392, to: 523, duration: 0.11, gain: 0.32, type: 'triangle' });
      tone(audio, { at: 0.1, freq: 659, duration: 0.1, gain: 0.28, type: 'triangle' });
      return;
    }
    if (name === 'leave') {
      tone(audio, { freq: 620, to: 415, duration: 0.13, gain: 0.28, type: 'triangle' });
      tone(audio, { at: 0.1, freq: 330, duration: 0.09, gain: 0.2, type: 'sine' });
      return;
    }
    if (name === 'stream') {
      tone(audio, { freq: 330, duration: 0.09, gain: 0.26, type: 'square' });
      tone(audio, { at: 0.08, freq: 494, duration: 0.09, gain: 0.25, type: 'triangle' });
      tone(audio, { at: 0.16, freq: 740, duration: 0.14, gain: 0.26, type: 'sine' });
      return;
    }
    if (name === 'camera') {
      tone(audio, { freq: 880, duration: 0.055, gain: 0.2, type: 'sine' });
      tone(audio, { at: 0.055, freq: 1175, duration: 0.08, gain: 0.24, type: 'triangle' });
      return;
    }
    if (name === 'mute') {
      tone(audio, { freq: 520, to: 300, duration: 0.085, gain: 0.3, type: 'sine' });
      return;
    }
    if (name === 'unmute') {
      tone(audio, { freq: 300, to: 540, duration: 0.085, gain: 0.3, type: 'sine' });
      return;
    }
    if (name === 'deafen') {
      tone(audio, { freq: 460, to: 220, duration: 0.075, gain: 0.28, type: 'sine' });
      tone(audio, { at: 0.07, freq: 300, to: 180, duration: 0.09, gain: 0.24, type: 'sine' });
      return;
    }
    if (name === 'undeafen') {
      tone(audio, { freq: 240, to: 400, duration: 0.075, gain: 0.26, type: 'sine' });
      tone(audio, { at: 0.07, freq: 420, to: 600, duration: 0.09, gain: 0.26, type: 'sine' });
      return;
    }
  }

  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  window.CortexSounds = { play, unlock };
})();
