/** Original, gesture-started sound design. HRTF movement is clearest on headphones. */
export type CinemaAudio = {
  start(): Promise<void>;
  setMuted(muted: boolean): void;
  cue(kind: "ingredient" | "reveal"): void;
  stop(): void;
};

export function createCinemaAudio(): CinemaAudio {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let mix: GainNode | null = null;
  let room: ConvolverNode | null = null;
  let noise: AudioBuffer | null = null;
  let muted = false;
  let stopped = false;
  let cueIndex = 0;
  let lastCue = -Infinity;
  let recordingRequest: AbortController | null = null;
  const nodes = new Set<AudioNode>();
  const sources = new Set<AudioScheduledSourceNode>();

  // Repeatable textures, independent of external downloads and recordings.
  let seed = 73129;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296 * 2 - 1;
  };
  function track<T extends AudioNode>(node: T): T {
    nodes.add(node);
    return node;
  }
  function run(source: AudioScheduledSourceNode, at: number, until?: number, transient: AudioNode[] = []) {
    sources.add(source);
    source.onended = () => {
      sources.delete(source);
      for (const node of [source, ...transient]) {
        node.disconnect();
        nodes.delete(node);
      }
    };
    source.start(at);
    if (until !== undefined) source.stop(until);
  }
  function envelope(at: number, attack: number, duration: number, level: number) {
    const node = track(context!.createGain());
    node.gain.setValueAtTime(0, at);
    node.gain.linearRampToValueAtTime(level, at + attack);
    node.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    return node;
  }
  function spatialWhoosh(reveal: boolean) {
    if (!context || !noise || !mix) return;
    const ctx = context;
    const now = ctx.currentTime;
    const duration = reveal ? 1.8 : 0.85;
    const source = track(ctx.createBufferSource());
    source.buffer = noise;
    const filter = track(ctx.createBiquadFilter());
    filter.type = "bandpass";
    filter.Q.value = 0.55;
    filter.frequency.setValueAtTime(reveal ? 360 : 700, now);
    filter.frequency.exponentialRampToValueAtTime(reveal ? 2100 : 2800, now + duration * 0.45);
    filter.frequency.exponentialRampToValueAtTime(450, now + duration);
    const swell = envelope(now, duration * 0.36, duration, reveal ? 0.17 : 0.095);
    const pan = track(ctx.createPanner());
    pan.panningModel = "HRTF";
    pan.distanceModel = "inverse";
    pan.refDistance = 1;
    pan.rolloffFactor = 0.3;
    const direction = cueIndex++ % 2 === 0 ? 1 : -1;
    // An arc past the listener: spatial movement, not a hard left/right toggle.
    for (let step = 0; step <= 18; step++) {
      const progress = step / 18;
      const angle = direction * (-Math.PI * 0.65 + progress * Math.PI * 1.3);
      const at = now + progress * duration;
      const x = Math.sin(angle) * 1.8;
      const z = -Math.cos(angle) * 1.8;
      if (step === 0) {
        pan.positionX.setValueAtTime(x, at);
        pan.positionY.setValueAtTime(0.15, at);
        pan.positionZ.setValueAtTime(z, at);
      } else {
        pan.positionX.linearRampToValueAtTime(x, at);
        pan.positionZ.linearRampToValueAtTime(z, at);
      }
    }
    source.connect(filter).connect(swell).connect(pan).connect(mix);
    run(source, now, now + duration + 0.04, [filter, swell, pan]);
  }
  function impact(reveal: boolean) {
    if (!context || !mix) return;
    const now = context.currentTime;
    const source = track(context.createOscillator());
    source.type = "sine";
    source.frequency.setValueAtTime(reveal ? 98 : 164.81, now);
    source.frequency.exponentialRampToValueAtTime(reveal ? 49 : 82.41, now + 0.22);
    const level = envelope(now, 0.012, reveal ? 1.3 : 0.45, reveal ? 0.2 : 0.09);
    source.connect(level).connect(mix);
    run(source, now, now + (reveal ? 1.4 : 0.5), [level]);
  }
  async function addFireRecording(ctx: AudioContext) {
    const request = new AbortController();
    recordingRequest = request;
    try {
      const response = await fetch("/sounds/cinema/fire-crackling.wav", { signal: request.signal });
      if (!response.ok || stopped || context !== ctx) return;
      const bytes = await response.arrayBuffer();
      if (stopped || context !== ctx || request.signal.aborted) return;
      const decoded = await ctx.decodeAudioData(bytes);
      if (stopped || context !== ctx || request.signal.aborted || !mix) return;
      // Overlap the tail and head so this short recording has a smooth loop seam.
      const overlap = Math.min(Math.floor(ctx.sampleRate * 0.09), Math.floor(decoded.length / 4));
      const loop = ctx.createBuffer(decoded.numberOfChannels, decoded.length - overlap, decoded.sampleRate);
      for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
        const input = decoded.getChannelData(channel);
        const output = loop.getChannelData(channel);
        output.set(input.subarray(0, output.length));
        for (let i = 0; i < overlap; i++) {
          const blend = i / overlap;
          output[i] = input[output.length + i] * (1 - blend) + input[i] * blend;
        }
      }
      const source = track(ctx.createBufferSource());
      source.buffer = loop;
      source.loop = true;
      const warm = track(ctx.createBiquadFilter());
      warm.type = "lowpass";
      warm.frequency.value = 5600;
      const level = track(ctx.createGain());
      level.gain.setValueAtTime(0, ctx.currentTime);
      // The source is already quiet (-31 dBFS average); retain its natural texture.
      level.gain.linearRampToValueAtTime(0.85, ctx.currentTime + 3);
      const pan = track(ctx.createPanner());
      pan.panningModel = "HRTF";
      pan.positionX.value = -0.65;
      pan.positionY.value = -0.15;
      pan.positionZ.value = -1.2;
      pan.rolloffFactor = 0.2;
      source.connect(warm).connect(level).connect(pan).connect(mix);
      run(source, ctx.currentTime, undefined, [warm, level, pan]);
    } catch {
      // The recording is optional. Offline, decode failure, or cancellation keeps the score playable.
    } finally {
      if (recordingRequest === request) recordingRequest = null;
    }
  }
  function stop() {
    if (stopped) return;
    stopped = true;
    recordingRequest?.abort();
    recordingRequest = null;
    const ctx = context;
    context = null;
    noise = null;
    if (!ctx) return;
    const at = ctx.currentTime;
    master?.gain.cancelScheduledValues(at);
    master?.gain.setTargetAtTime(0, at, 0.015);
    for (const source of sources) {
      try { source.stop(at + 0.075); } catch { /* A completed source is already silent. */ }
    }
    const dispose = () => {
      for (const node of nodes) node.disconnect();
      nodes.clear();
      sources.clear();
      master = null;
      mix = null;
      room = null;
      if (ctx.state !== "closed") void ctx.close().catch(() => {});
    };
    // Only the short release remains; no animation loop or persistent timer.
    window.setTimeout(dispose, ctx.state === "running" ? 90 : 0);
  }

  return {
    async start() {
      if (context || stopped || typeof window === "undefined") return;
      const Constructor = window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Constructor) throw new Error("Audio is unavailable on this device");
      const ctx = new Constructor();
      context = ctx;
      // This call happens before the first await, inside the caller's click handler.
      const resumed = ctx.resume();
      try {
        master = track(ctx.createGain());
        master.gain.value = muted ? 0 : 0.58;
        const compressor = track(ctx.createDynamicsCompressor());
        compressor.threshold.value = -18;
        compressor.knee.value = 12;
        compressor.ratio.value = 4;
        compressor.attack.value = 0.006;
        compressor.release.value = 0.2;
        mix = track(ctx.createGain());
        mix.connect(compressor).connect(master).connect(ctx.destination);

        room = track(ctx.createConvolver());
        const impulse = ctx.createBuffer(2, Math.ceil(ctx.sampleRate * 1.15), ctx.sampleRate);
        for (let channel = 0; channel < 2; channel++) {
          const values = impulse.getChannelData(channel);
          for (let i = 0; i < values.length; i++) {
            values[i] = random() * Math.pow(1 - i / values.length, 3.5) * 0.3;
          }
        }
        room.buffer = impulse;
        const wet = track(ctx.createGain());
        wet.gain.value = 0.16;
        mix.connect(room).connect(wet).connect(compressor);

        noise = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
        const samples = noise.getChannelData(0);
        let smooth = 0;
        for (let i = 0; i < samples.length; i++) {
          smooth = smooth * 0.88 + random() * 0.12;
          samples[i] = smooth * 2;
        }
        const now = ctx.currentTime;
        // A quiet D-minor suspended bed, with a slow attack and no synthetic voice.
        for (const [frequency, detune, volume] of [[73.416, -3, 0.1], [110, 3, 0.035], [174.614, -2, 0.025]]) {
          const oscillator = track(ctx.createOscillator());
          oscillator.type = "sine";
          oscillator.frequency.value = frequency;
          oscillator.detune.value = detune;
          const level = track(ctx.createGain());
          level.gain.setValueAtTime(0, now);
          level.gain.linearRampToValueAtTime(volume, now + 1.7);
          oscillator.connect(level).connect(mix);
          run(oscillator, now);
        }
        spatialWhoosh(true);
        void addFireRecording(ctx);
        await resumed;
      } catch (error) {
        void resumed.catch(() => {});
        stop();
        throw error;
      }
    },
    setMuted(value) {
      muted = value;
      if (!context || !master || stopped) return;
      const now = context.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setTargetAtTime(value ? 0 : 0.58, now, 0.025);
    },
    cue(kind) {
      if (!context || stopped || context.state !== "running") return;
      // Avoid stacked impacts during repeated taps; a reveal always gets its cue.
      if (kind === "ingredient" && context.currentTime - lastCue < 0.18) return;
      lastCue = context.currentTime;
      spatialWhoosh(kind === "reveal");
      impact(kind === "reveal");
    },
    stop,
  };
}
