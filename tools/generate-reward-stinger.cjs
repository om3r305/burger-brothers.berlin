const fs = require("fs");
const path = require("path");

const sampleRate = 44_100;
const durationSeconds = 3.65;
const frames = Math.ceil(sampleRate * durationSeconds);
const left = new Float64Array(frames);
const right = new Float64Array(frames);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function panGains(pan) {
  const angle = ((clamp(pan, -1, 1) + 1) * Math.PI) / 4;
  return [Math.cos(angle), Math.sin(angle)];
}

function envelope(time, duration, attack = 0.018, release = 0.42) {
  if (time < 0 || time > duration) return 0;
  const attackGain = Math.min(1, time / Math.max(0.001, attack));
  const releaseStart = Math.max(attack, duration - release);
  const releaseGain =
    time <= releaseStart
      ? 1
      : Math.max(0, 1 - (time - releaseStart) / Math.max(0.001, release));
  return attackGain * releaseGain;
}

function addBell(frequency, start, duration, gain, pan = 0) {
  const startFrame = Math.max(0, Math.floor(start * sampleRate));
  const endFrame = Math.min(frames, Math.ceil((start + duration) * sampleRate));
  const [leftGain, rightGain] = panGains(pan);
  const partials = [
    [1, 1],
    [2.01, 0.28],
    [3.98, 0.09],
  ];

  for (let frame = startFrame; frame < endFrame; frame += 1) {
    const time = frame / sampleRate - start;
    const env =
      envelope(time, duration, 0.012, Math.min(0.82, duration * 0.68)) *
      Math.exp(-time * 0.72);
    let sample = 0;
    for (const [ratio, weight] of partials) {
      sample += Math.sin(2 * Math.PI * frequency * ratio * time) * weight;
    }
    sample *= gain * env;
    left[frame] += sample * leftGain;
    right[frame] += sample * rightGain;
  }
}

function addPad(frequency, start, duration, gain, pan = 0) {
  const startFrame = Math.max(0, Math.floor(start * sampleRate));
  const endFrame = Math.min(frames, Math.ceil((start + duration) * sampleRate));
  const [leftGain, rightGain] = panGains(pan);

  for (let frame = startFrame; frame < endFrame; frame += 1) {
    const time = frame / sampleRate - start;
    const env = envelope(time, duration, 0.24, 0.85);
    const fundamental = Math.sin(2 * Math.PI * frequency * time);
    const warm = Math.sin(2 * Math.PI * frequency * 2 * time) * 0.18;
    const sample = (fundamental + warm) * gain * env;
    left[frame] += sample * leftGain;
    right[frame] += sample * rightGain;
  }
}

function addImpact(start, gain) {
  const duration = 0.72;
  const startFrame = Math.max(0, Math.floor(start * sampleRate));
  const endFrame = Math.min(frames, Math.ceil((start + duration) * sampleRate));
  let seed = 0x5f3759df;
  let smoothedNoise = 0;

  for (let frame = startFrame; frame < endFrame; frame += 1) {
    const time = frame / sampleRate - start;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const noise = (seed / 0xffffffff) * 2 - 1;
    smoothedNoise += (noise - smoothedNoise) * 0.055;
    const low = Math.sin(2 * Math.PI * (82 - time * 24) * time);
    const env = Math.exp(-time * 6.2);
    const sample = (low * 0.76 + smoothedNoise * 0.24) * gain * env;
    left[frame] += sample;
    right[frame] += sample;
  }
}

function addShimmer(start, duration, gain) {
  const startFrame = Math.max(0, Math.floor(start * sampleRate));
  const endFrame = Math.min(frames, Math.ceil((start + duration) * sampleRate));
  let seed = 0x31415926;
  let highPassMemory = 0;

  for (let frame = startFrame; frame < endFrame; frame += 1) {
    const time = frame / sampleRate - start;
    seed = (seed * 1103515245 + 12345) >>> 0;
    const noise = (seed / 0xffffffff) * 2 - 1;
    const high = noise - highPassMemory * 0.93;
    highPassMemory = noise;
    const env =
      Math.sin(Math.PI * clamp(time / duration, 0, 1)) *
      Math.exp(-time * 0.42);
    const pan = Math.sin(time * 4.1) * 0.32;
    const [leftGain, rightGain] = panGains(pan);
    const sample = high * gain * env;
    left[frame] += sample * leftGain;
    right[frame] += sample * rightGain;
  }
}

addImpact(0.04, 0.32);
addShimmer(0.02, 2.95, 0.018);

[
  [523.25, 0.08, 0.88, 0.21, -0.25],
  [659.25, 0.28, 0.9, 0.2, 0.2],
  [783.99, 0.48, 0.98, 0.19, -0.12],
  [1046.5, 0.72, 1.18, 0.22, 0.26],
].forEach(([frequency, start, duration, gain, pan]) =>
  addBell(frequency, start, duration, gain, pan),
);

addImpact(1.02, 0.2);
[
  [261.63, -0.35],
  [329.63, -0.12],
  [392, 0.13],
  [523.25, 0.35],
].forEach(([frequency, pan]) => addPad(frequency, 1.02, 2.18, 0.055, pan));

[
  [783.99, 1.2, 1.05, 0.12, -0.22],
  [987.77, 1.4, 1.04, 0.11, 0.22],
  [1174.66, 1.6, 1.15, 0.105, -0.08],
  [1567.98, 1.84, 1.2, 0.09, 0.18],
].forEach(([frequency, start, duration, gain, pan]) =>
  addBell(frequency, start, duration, gain, pan),
);

let peak = 0;
for (let index = 0; index < frames; index += 1) {
  left[index] = Math.tanh(left[index] * 1.18);
  right[index] = Math.tanh(right[index] * 1.18);
  peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index]));
}

const normalize = peak > 0 ? 0.86 / peak : 1;
const channels = 2;
const bitsPerSample = 16;
const blockAlign = (channels * bitsPerSample) / 8;
const byteRate = sampleRate * blockAlign;
const dataSize = frames * blockAlign;
const output = Buffer.alloc(44 + dataSize);

output.write("RIFF", 0);
output.writeUInt32LE(36 + dataSize, 4);
output.write("WAVE", 8);
output.write("fmt ", 12);
output.writeUInt32LE(16, 16);
output.writeUInt16LE(1, 20);
output.writeUInt16LE(channels, 22);
output.writeUInt32LE(sampleRate, 24);
output.writeUInt32LE(byteRate, 28);
output.writeUInt16LE(blockAlign, 32);
output.writeUInt16LE(bitsPerSample, 34);
output.write("data", 36);
output.writeUInt32LE(dataSize, 40);

let offset = 44;
for (let index = 0; index < frames; index += 1) {
  output.writeInt16LE(Math.round(clamp(left[index] * normalize, -1, 1) * 32767), offset);
  output.writeInt16LE(Math.round(clamp(right[index] * normalize, -1, 1) * 32767), offset + 2);
  offset += 4;
}

const target = path.join(
  __dirname,
  "..",
  "public",
  "sounds",
  "reward-celebration.wav",
);
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, output);
console.log(
  `Reward stinger generated: ${path.relative(process.cwd(), target)} (${durationSeconds.toFixed(2)}s, stereo)`,
);
