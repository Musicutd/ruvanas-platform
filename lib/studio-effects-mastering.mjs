export const STUDIO_EFFECT_PRESETS = Object.freeze({
  NONE: Object.freeze({ enabled: false, preset: "NONE", tone: "NEUTRAL", compression: 0, gate: 0, reverb: 0, delayMs: 0, highpassHz: 0, lowpassHz: 0, hardLimiter: false }),
  BROADCAST_VOICE: Object.freeze({ enabled: true, preset: "BROADCAST_VOICE", tone: "BROADCAST", compression: 60, gate: 15, reverb: 0, delayMs: 0, highpassHz: 75, lowpassHz: 16000, hardLimiter: false }),
  PODCAST_VOICE: Object.freeze({ enabled: true, preset: "PODCAST_VOICE", tone: "WARM", compression: 40, gate: 10, reverb: 4, delayMs: 0, highpassHz: 65, lowpassHz: 18000, hardLimiter: false }),
  PROMO_VOICE: Object.freeze({ enabled: true, preset: "PROMO_VOICE", tone: "BRIGHT", compression: 70, gate: 15, reverb: 8, delayMs: 70, highpassHz: 85, lowpassHz: 17000, hardLimiter: true }),
  TELEPHONE_VOICE: Object.freeze({ enabled: true, preset: "TELEPHONE_VOICE", tone: "TELEPHONE", compression: 45, gate: 15, reverb: 0, delayMs: 0, highpassHz: 300, lowpassHz: 3400, hardLimiter: true }),
  WARM_VOICE: Object.freeze({ enabled: true, preset: "WARM_VOICE", tone: "WARM", compression: 30, gate: 0, reverb: 6, delayMs: 0, highpassHz: 60, lowpassHz: 18000, hardLimiter: false }),
  CLEAN_INTERVIEW: Object.freeze({ enabled: true, preset: "CLEAN_INTERVIEW", tone: "NEUTRAL", compression: 35, gate: 25, reverb: 0, delayMs: 0, highpassHz: 70, lowpassHz: 17000, hardLimiter: false })
});

export const STUDIO_MASTERING_PRESETS = Object.freeze({
  PODCAST: Object.freeze({ enabled: true, preset: "PODCAST", targetLufs: -16, truePeakDbfs: -1.5, maxLoudnessRangeLu: 12, limiter: true }),
  ONLINE_RADIO: Object.freeze({ enabled: true, preset: "ONLINE_RADIO", targetLufs: -16, truePeakDbfs: -1, maxLoudnessRangeLu: 12, limiter: true }),
  RETAIL_PROMO: Object.freeze({ enabled: true, preset: "RETAIL_PROMO", targetLufs: -14, truePeakDbfs: -1, maxLoudnessRangeLu: 10, limiter: true }),
  SCHOOL_PROGRAMME: Object.freeze({ enabled: true, preset: "SCHOOL_PROGRAMME", targetLufs: -18, truePeakDbfs: -1.5, maxLoudnessRangeLu: 14, limiter: true }),
  OFF: Object.freeze({ enabled: false, preset: "OFF", targetLufs: -16, truePeakDbfs: -1.5, maxLoudnessRangeLu: 12, limiter: false })
});

const EFFECT_TONES = new Set(["NEUTRAL", "WARM", "BRIGHT", "BROADCAST", "TELEPHONE"]);
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, minimum, maximum, fallback = minimum) => Math.min(maximum, Math.max(minimum, finite(value, fallback)));

export function applyStudioEffectPreset(name) {
  return { ...(STUDIO_EFFECT_PRESETS[name] || STUDIO_EFFECT_PRESETS.NONE) };
}

export function normalizeStudioEffects(value) {
  const input = value && typeof value === "object" ? value : STUDIO_EFFECT_PRESETS.NONE;
  return {
    enabled: input.enabled === true,
    preset: Object.hasOwn(STUDIO_EFFECT_PRESETS, input.preset) ? input.preset : "CUSTOM",
    tone: EFFECT_TONES.has(input.tone) ? input.tone : "NEUTRAL",
    compression: Math.round(clamp(input.compression, 0, 100)),
    gate: Math.round(clamp(input.gate, 0, 100)),
    reverb: Math.round(clamp(input.reverb, 0, 30)),
    delayMs: Math.round(clamp(input.delayMs, 0, 250)),
    highpassHz: Math.round(clamp(input.highpassHz, 0, 500)),
    lowpassHz: Math.round(clamp(input.lowpassHz, 0, 20000)),
    hardLimiter: input.hardLimiter === true
  };
}

function toneFilters(tone) {
  if (tone === "WARM") return ["equalizer=f=180:t=q:w=1:g=2", "equalizer=f=4200:t=q:w=1:g=-1"];
  if (tone === "BRIGHT") return ["equalizer=f=280:t=q:w=1:g=-1", "equalizer=f=4500:t=q:w=1:g=2.5"];
  if (tone === "BROADCAST") return ["equalizer=f=160:t=q:w=1:g=1.5", "equalizer=f=400:t=q:w=1:g=-1.5", "equalizer=f=3800:t=q:w=1:g=2"];
  return [];
}

export function buildStudioEffectsFilters(value) {
  const effects = normalizeStudioEffects(value);
  if (!effects.enabled) return [];
  const filters = [];
  if (effects.highpassHz >= 20) filters.push(`highpass=f=${effects.highpassHz}`);
  if (effects.lowpassHz >= 1000) filters.push(`lowpass=f=${effects.lowpassHz}`);
  if (effects.gate > 0) {
    const threshold = (-55 + effects.gate * 0.2).toFixed(1);
    const ratio = (1.2 + effects.gate * 0.04).toFixed(2);
    filters.push(`agate=threshold=${threshold}dB:ratio=${ratio}:attack=10:release=180`);
  }
  if (effects.tone === "TELEPHONE") {
    if (effects.highpassHz < 20) filters.push("highpass=f=300");
    if (effects.lowpassHz < 1000) filters.push("lowpass=f=3400");
  } else {
    filters.push(...toneFilters(effects.tone));
  }
  if (effects.compression > 0) {
    const threshold = (-13 - effects.compression * 0.12).toFixed(1);
    const ratio = (1.3 + effects.compression * 0.035).toFixed(2);
    filters.push(`acompressor=threshold=${threshold}dB:ratio=${ratio}:attack=12:release=180`);
  }
  if (effects.reverb > 0) {
    const decay = (effects.reverb / 100).toFixed(2);
    filters.push(`aecho=0.8:0.8:45:${decay}`);
  }
  if (effects.delayMs > 0) filters.push(`aecho=0.8:0.75:${effects.delayMs}:0.22`);
  if (effects.hardLimiter) filters.push("alimiter=limit=0.92");
  return filters;
}

export function applyStudioMasteringPreset(name) {
  return { ...(STUDIO_MASTERING_PRESETS[name] || STUDIO_MASTERING_PRESETS.PODCAST) };
}

export function normalizeStudioMastering(value, legacy = {}) {
  const input = value && typeof value === "object" ? value : {
    enabled: legacy.normalize !== false,
    preset: "CUSTOM",
    targetLufs: legacy.targetLufs ?? -16,
    truePeakDbfs: -1.5,
    maxLoudnessRangeLu: 12,
    limiter: legacy.limiter !== false
  };
  return {
    enabled: input.enabled !== false,
    preset: Object.hasOwn(STUDIO_MASTERING_PRESETS, input.preset) ? input.preset : "CUSTOM",
    targetLufs: Number(clamp(input.targetLufs, -24, -9, -16).toFixed(1)),
    truePeakDbfs: Number(clamp(input.truePeakDbfs, -3, -0.5, -1.5).toFixed(1)),
    maxLoudnessRangeLu: Number(clamp(input.maxLoudnessRangeLu, 1, 20, 12).toFixed(1)),
    limiter: input.limiter !== false
  };
}

export function buildStudioMasteringFilters(value) {
  const mastering = normalizeStudioMastering(value);
  if (!mastering.enabled) return [];
  const dynamicsRatio = Math.max(2, Math.min(4, 36 / mastering.maxLoudnessRangeLu)).toFixed(2);
  const filters = [
    `acompressor=threshold=0.0631:ratio=${dynamicsRatio}:attack=20:release=250:knee=2.828:makeup=1`,
    `loudnorm=I=${mastering.targetLufs}:TP=${mastering.truePeakDbfs}:LRA=${mastering.maxLoudnessRangeLu}`
  ];
  // FFmpeg's limiter enables automatic make-up gain by default. That can lift a
  // correctly limited master back towards 0 dBFS and violate the chosen ceiling.
  if (mastering.limiter) filters.push(`alimiter=limit=${Math.pow(10, mastering.truePeakDbfs / 20).toFixed(4)}:level=false`);
  return filters;
}

export function studioMasteringCorrectionDb(report = {}, value = {}) {
  const mastering = normalizeStudioMastering(value);
  const measured = report.integratedLufs === null || report.integratedLufs === undefined || report.integratedLufs === ""
    ? Number.NaN
    : Number(report.integratedLufs);
  if (!mastering.enabled || !Number.isFinite(measured)) return 0;
  const difference = mastering.targetLufs - measured;
  if (Math.abs(difference) <= 1) return 0;
  return Number(Math.max(-6, Math.min(6, difference)).toFixed(1));
}

export function buildStudioMasteringCorrectionFilters(value, correctionDb) {
  const mastering = normalizeStudioMastering(value);
  const correction = Math.max(-6, Math.min(6, Number(correctionDb) || 0));
  if (!mastering.enabled || Math.abs(correction) < 0.05) return [];
  const filters = [`volume=${correction.toFixed(1)}dB`];
  if (mastering.limiter) filters.push(`alimiter=limit=${Math.pow(10, mastering.truePeakDbfs / 20).toFixed(4)}:level=false`);
  return filters;
}

export function evaluateStudioMasteringQuality(report = {}, value = {}) {
  const mastering = normalizeStudioMastering(value);
  if (!mastering.enabled) return { status: "NOT_MEASURED", findings: ["Loudness matching is off for this output."] };
  const findings = [];
  const measurement = (candidate) => candidate === null || candidate === undefined || candidate === "" ? Number.NaN : Number(candidate);
  const loudness = measurement(report.integratedLufs);
  const peak = measurement(report.truePeakDbfs);
  const range = measurement(report.loudnessRangeLu);
  if (!Number.isFinite(loudness)) findings.push("Integrated loudness could not be measured.");
  else if (Math.abs(loudness - mastering.targetLufs) > 1) findings.push(`Measured ${loudness.toFixed(1)} LUFS; target is ${mastering.targetLufs.toFixed(1)} LUFS.`);
  if (!Number.isFinite(peak)) findings.push("True Peak could not be measured.");
  else if (peak > mastering.truePeakDbfs + 0.2) findings.push(`True Peak is ${peak.toFixed(1)} dBTP; ceiling is ${mastering.truePeakDbfs.toFixed(1)} dBTP.`);
  if (!Number.isFinite(range)) findings.push("Loudness range could not be measured.");
  else if (range > mastering.maxLoudnessRangeLu + 0.5) findings.push(`Loudness range is ${range.toFixed(1)} LU; expected no more than ${mastering.maxLoudnessRangeLu.toFixed(1)} LU.`);
  return { status: findings.length ? "NEEDS_ATTENTION" : "READY", findings };
}

export function studioEffectLabel(value) {
  const preset = normalizeStudioEffects(value).preset;
  return ({ NONE: "No effects", BROADCAST_VOICE: "Broadcast Voice", PODCAST_VOICE: "Podcast Voice", PROMO_VOICE: "Promo Voice", TELEPHONE_VOICE: "Telephone Voice", WARM_VOICE: "Warm Voice", CLEAN_INTERVIEW: "Clean Interview", CUSTOM: "Custom effects" })[preset];
}

export function studioMasteringLabel(value) {
  const preset = normalizeStudioMastering(value).preset;
  return ({ PODCAST: "Podcast", ONLINE_RADIO: "Online Radio", RETAIL_PROMO: "Retail Promo", SCHOOL_PROGRAMME: "School Programme", OFF: "Off", CUSTOM: "Custom target" })[preset];
}
