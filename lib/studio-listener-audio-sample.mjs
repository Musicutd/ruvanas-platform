// Offline analysis of deliberately generated, self-owned acceptance tones.
// Input is decoded mono 16-bit little-endian PCM at 16 kHz, captured from the
// isolated *listener* endpoint by an independent recorder. This function does
// not establish recording provenance or create proof-of-play.
const SAMPLE_RATE = 16_000;
const WINDOW_SAMPLES = SAMPLE_RATE;
const MAX_SECONDS = 120;
const TEST_TONES = Object.freeze({ AUTODJ: 440, MANUAL: 660, PROTECTED: 880 });

function toneFraction(samples, frequency, energy) {
  let strongest = 0;
  for (const offset of [-2, -1, 0, 1, 2]) {
    const omega = 2 * Math.PI * (frequency + offset) / SAMPLE_RATE;
    const coefficient = 2 * Math.cos(omega);
    let previous = 0;
    let beforePrevious = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const current = samples[index] + coefficient * previous - beforePrevious;
      beforePrevious = previous;
      previous = current;
    }
    const power = previous * previous + beforePrevious * beforePrevious - coefficient * previous * beforePrevious;
    strongest = Math.max(strongest, 2 * power / (samples.length * energy));
  }
  return Math.max(0, Math.min(1, strongest));
}

function classifyWindow(pcm, offset) {
  const samples = new Float64Array(WINDOW_SAMPLES);
  let energy = 0;
  for (let index = 0; index < WINDOW_SAMPLES; index += 1) {
    const value = pcm.readInt16LE(offset + index * 2) / 32768;
    samples[index] = value;
    energy += value * value;
  }
  const rms = Math.sqrt(energy / WINDOW_SAMPLES);
  if (rms < 0.02) return "SILENCE";
  const ranked = Object.entries(TEST_TONES)
    .map(([label, frequency]) => ({ label, fraction: toneFraction(samples, frequency, energy) }))
    .sort((left, right) => right.fraction - left.fraction);
  if (ranked[0].fraction < 0.55 || ranked[0].fraction < 3 * ranked[1].fraction) return "UNKNOWN";
  return ranked[0].label;
}

export function analyzeStudioListenerPcm(pcm) {
  if (!Buffer.isBuffer(pcm) || pcm.byteLength % 2 !== 0 ||
      pcm.byteLength < 2 * SAMPLE_RATE * 2 || pcm.byteLength > MAX_SECONDS * SAMPLE_RATE * 2) {
    throw new Error("Provide 2–120 seconds of mono 16-bit little-endian PCM at 16 kHz.");
  }
  const labels = [];
  for (let offset = 0; offset + WINDOW_SAMPLES * 2 <= pcm.byteLength; offset += WINDOW_SAMPLES * 2) {
    labels.push(classifyWindow(pcm, offset));
  }
  return {
    sampleRateHz: SAMPLE_RATE,
    secondsAnalyzed: labels.length,
    oneSecondWindows: labels,
    listenerVerified: false,
    interpretation: "LOCAL_AUDIO_SAMPLE_ONLY"
  };
}
