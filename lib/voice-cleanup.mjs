export const VOICE_CLEANUP_PRESETS = Object.freeze({
  OFF: Object.freeze({ enabled: false, preset: "OFF", noiseReduction: 0, rumbleHz: 0, humHz: 0, deEss: 0, voiceEq: "NEUTRAL", speechLeveling: 0, limiter: false }),
  GENTLE: Object.freeze({ enabled: true, preset: "GENTLE", noiseReduction: 25, rumbleHz: 70, humHz: 0, deEss: 20, voiceEq: "NEUTRAL", speechLeveling: 25, limiter: true }),
  CLEAN_DIALOGUE: Object.freeze({ enabled: true, preset: "CLEAN_DIALOGUE", noiseReduction: 45, rumbleHz: 80, humHz: 0, deEss: 35, voiceEq: "NEUTRAL", speechLeveling: 45, limiter: true }),
  BROADCAST: Object.freeze({ enabled: true, preset: "BROADCAST", noiseReduction: 35, rumbleHz: 90, humHz: 0, deEss: 30, voiceEq: "BROADCAST", speechLeveling: 60, limiter: true })
});

export const DEFAULT_VOICE_CLEANUP = VOICE_CLEANUP_PRESETS.GENTLE;
export const VOICE_EQ_OPTIONS = Object.freeze(["NEUTRAL", "MALE", "FEMALE", "BROADCAST"]);

const number = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, number(value, minimum)));

export function applyVoiceCleanupPreset(name) {
  const preset = VOICE_CLEANUP_PRESETS[name] || VOICE_CLEANUP_PRESETS.GENTLE;
  return { ...preset };
}

export function normalizeVoiceCleanup(value, legacyNoiseCleanup = false) {
  const input = value && typeof value === "object"
    ? value
    : legacyNoiseCleanup
      ? VOICE_CLEANUP_PRESETS.GENTLE
      : VOICE_CLEANUP_PRESETS.OFF;
  const preset = Object.hasOwn(VOICE_CLEANUP_PRESETS, input.preset) ? input.preset : "CUSTOM";
  const voiceEq = VOICE_EQ_OPTIONS.includes(input.voiceEq) ? input.voiceEq : "NEUTRAL";
  const humHz = [0, 50, 60].includes(Number(input.humHz)) ? Number(input.humHz) : 0;
  return {
    enabled: input.enabled === true,
    preset,
    noiseReduction: Math.round(clamp(input.noiseReduction, 0, 100)),
    rumbleHz: Math.round(clamp(input.rumbleHz, 0, 160)),
    humHz,
    deEss: Math.round(clamp(input.deEss, 0, 100)),
    voiceEq,
    speechLeveling: Math.round(clamp(input.speechLeveling, 0, 100)),
    limiter: input.limiter === true
  };
}

function equalizerFilters(voiceEq) {
  if (voiceEq === "MALE") return ["equalizer=f=140:t=q:w=1:g=1.5", "equalizer=f=3200:t=q:w=1:g=1.2"];
  if (voiceEq === "FEMALE") return ["equalizer=f=220:t=q:w=1:g=1.2", "equalizer=f=4200:t=q:w=1:g=1.4"];
  if (voiceEq === "BROADCAST") return ["equalizer=f=180:t=q:w=1:g=1.5", "equalizer=f=350:t=q:w=1:g=-1.5", "equalizer=f=3600:t=q:w=1:g=2"];
  return [];
}

export function buildVoiceCleanupFilters(value, options = {}) {
  const cleanup = normalizeVoiceCleanup(value);
  if (!cleanup.enabled || options.bypass === true) return [];
  const filters = [];
  if (cleanup.rumbleHz >= 40) filters.push(`highpass=f=${cleanup.rumbleHz}`);
  if (cleanup.humHz) {
    filters.push(`equalizer=f=${cleanup.humHz}:t=q:w=10:g=-14`);
    filters.push(`equalizer=f=${cleanup.humHz * 2}:t=q:w=10:g=-8`);
  }
  if (cleanup.noiseReduction > 0) {
    const noiseFloor = (-36 + cleanup.noiseReduction * 0.14).toFixed(1);
    filters.push(`afftdn=nf=${noiseFloor}:tn=1`);
  }
  if (cleanup.deEss > 0) {
    const intensity = (0.12 + cleanup.deEss * 0.005).toFixed(2);
    const maximum = (0.25 + cleanup.deEss * 0.005).toFixed(2);
    filters.push(`deesser=i=${intensity}:m=${maximum}:f=0.5`);
  }
  filters.push(...equalizerFilters(cleanup.voiceEq));
  if (cleanup.speechLeveling > 0) {
    const threshold = (-14 - cleanup.speechLeveling * 0.1).toFixed(1);
    const ratio = (1.5 + cleanup.speechLeveling * 0.025).toFixed(2);
    filters.push(`acompressor=threshold=${threshold}dB:ratio=${ratio}:attack=10:release=160`);
  }
  if (cleanup.limiter) filters.push("alimiter=limit=0.95");
  return filters;
}

export function voiceCleanupLabel(value) {
  const cleanup = normalizeVoiceCleanup(value);
  if (!cleanup.enabled) return "Off";
  if (cleanup.preset === "GENTLE") return "Gentle repair";
  if (cleanup.preset === "CLEAN_DIALOGUE") return "Clean dialogue";
  if (cleanup.preset === "BROADCAST") return "Broadcast voice";
  return "Custom repair";
}
