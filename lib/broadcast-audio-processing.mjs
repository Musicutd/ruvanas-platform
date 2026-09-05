export const BROADCAST_PROCESSING_TEMPLATES = Object.freeze({
  WEB_RADIO: Object.freeze({
    name: "Web Radio",
    purpose: "Balanced high-quality processing for continuous online radio.",
    codec: "MP3",
    bitrateKbps: 192,
    sampleRateHz: 48000,
    targetLufs: -16,
    truePeakDbfs: -1.5,
    maxLoudnessRangeLu: 12,
    highpassHz: 30,
    lowpassHz: 18000,
    compressionThresholdDb: -18,
    compressionRatio: 2.5,
    compressionAttackMs: 20,
    compressionReleaseMs: 250,
    limiterEnabled: true
  }),
  TALK_RADIO: Object.freeze({
    name: "Talk Radio",
    purpose: "Clear, controlled speech for interviews, news and presenter-led shows.",
    codec: "AAC",
    bitrateKbps: 128,
    sampleRateHz: 48000,
    targetLufs: -18,
    truePeakDbfs: -1.5,
    maxLoudnessRangeLu: 9,
    highpassHz: 70,
    lowpassHz: 15000,
    compressionThresholdDb: -20,
    compressionRatio: 3.5,
    compressionAttackMs: 10,
    compressionReleaseMs: 180,
    limiterEnabled: true
  }),
  ARCHIVE_MASTER: Object.freeze({
    name: "Archive Master",
    purpose: "Lossless 48 kHz master for future distribution and reprocessing.",
    codec: "WAV",
    bitrateKbps: 320,
    sampleRateHz: 48000,
    targetLufs: -23,
    truePeakDbfs: -2,
    maxLoudnessRangeLu: 18,
    highpassHz: 20,
    lowpassHz: 20000,
    compressionThresholdDb: -24,
    compressionRatio: 1.5,
    compressionAttackMs: 40,
    compressionReleaseMs: 400,
    limiterEnabled: true
  })
});

const CODECS = new Set(["MP3", "AAC", "WAV"]);
const BITRATES = new Set([64, 96, 128, 160, 192, 256, 320]);
const SAMPLE_RATES = new Set([44100, 48000]);

function text(value, label, { min = 0, max }) {
  const normalized = String(value || "").trim().replace(/\s+/g, " ");
  if (normalized.length < min || normalized.length > max) throw new Error(`${label} must be between ${min} and ${max} characters.`);
  return normalized || null;
}

function number(value, label, min, max) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < min || normalized > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return normalized;
}

function integer(value, label, allowed) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || !allowed.has(normalized)) throw new Error(`Choose a supported ${label}.`);
  return normalized;
}

export function normalizeBroadcastProcessingProfile(input = {}) {
  const codec = String(input.codec || "MP3").toUpperCase();
  if (!CODECS.has(codec)) throw new Error("Choose MP3, AAC or WAV output.");
  const highpassHz = Math.round(number(input.highpassHz ?? 30, "high-pass frequency", 20, 200));
  const lowpassHz = Math.round(number(input.lowpassHz ?? 18000, "low-pass frequency", 8000, 20000));
  if (highpassHz >= lowpassHz) throw new Error("The high-pass frequency must remain below the low-pass frequency.");
  return {
    name: text(input.name, "Profile name", { min: 2, max: 120 }),
    purpose: text(input.purpose, "Purpose", { max: 500 }),
    codec,
    bitrateKbps: integer(input.bitrateKbps ?? 192, "bitrate", BITRATES),
    sampleRateHz: integer(input.sampleRateHz ?? 48000, "sample rate", SAMPLE_RATES),
    targetLufs: number(input.targetLufs ?? -16, "target loudness", -24, -9),
    truePeakDbfs: number(input.truePeakDbfs ?? -1.5, "true-peak ceiling", -3, -0.5),
    maxLoudnessRangeLu: number(input.maxLoudnessRangeLu ?? 12, "maximum loudness range", 1, 20),
    highpassHz,
    lowpassHz,
    compressionThresholdDb: number(input.compressionThresholdDb ?? -18, "compressor threshold", -40, -6),
    compressionRatio: number(input.compressionRatio ?? 2.5, "compressor ratio", 1, 10),
    compressionAttackMs: Math.round(number(input.compressionAttackMs ?? 20, "compressor attack", 1, 200)),
    compressionReleaseMs: Math.round(number(input.compressionReleaseMs ?? 250, "compressor release", 20, 2000)),
    limiterEnabled: input.limiterEnabled !== false
  };
}

export function broadcastProcessingSnapshot(profile) {
  const normalized = normalizeBroadcastProcessingProfile(profile);
  return { profileId: String(profile.id || ""), revision: Math.max(1, Number(profile.version) || 1), ...normalized };
}

export function buildBroadcastProcessingFilters(input) {
  const profile = normalizeBroadcastProcessingProfile(input);
  const filters = [
    `highpass=f=${profile.highpassHz}`,
    `lowpass=f=${profile.lowpassHz}`
  ];
  if (profile.compressionRatio > 1) {
    filters.push(`acompressor=threshold=${profile.compressionThresholdDb}dB:ratio=${profile.compressionRatio.toFixed(2)}:attack=${profile.compressionAttackMs}:release=${profile.compressionReleaseMs}`);
  }
  filters.push(`loudnorm=I=${profile.targetLufs}:TP=${profile.truePeakDbfs}:LRA=${profile.maxLoudnessRangeLu}`);
  if (profile.limiterEnabled) filters.push(`alimiter=limit=${Math.pow(10, profile.truePeakDbfs / 20).toFixed(4)}`);
  return filters;
}

export function broadcastEncoding(input) {
  const profile = normalizeBroadcastProcessingProfile(input);
  if (profile.codec === "WAV") return { extension: "wav", mimeType: "audio/wav", codecArgs: ["-ar", String(profile.sampleRateHz), "-c:a", "pcm_s24le"] };
  if (profile.codec === "AAC") return { extension: "m4a", mimeType: "audio/mp4", codecArgs: ["-ar", String(profile.sampleRateHz), "-c:a", "aac", "-b:a", `${profile.bitrateKbps}k`, "-movflags", "+faststart"] };
  return { extension: "mp3", mimeType: "audio/mpeg", codecArgs: ["-ar", String(profile.sampleRateHz), "-c:a", "libmp3lame", "-b:a", `${profile.bitrateKbps}k`] };
}

export function evaluateBroadcastProcessingQc(report = {}, input = {}) {
  const profile = normalizeBroadcastProcessingProfile(input);
  const findings = [];
  const integratedLufs = Number(report.integratedLufs);
  const truePeakDbfs = Number(report.truePeakDbfs);
  const loudnessRangeLu = Number(report.loudnessRangeLu);
  if (!Number.isFinite(integratedLufs)) findings.push("Integrated loudness could not be measured.");
  else if (Math.abs(integratedLufs - profile.targetLufs) > 1) findings.push(`Integrated loudness is ${integratedLufs.toFixed(1)} LUFS; expected within 1 LU of ${profile.targetLufs.toFixed(1)} LUFS.`);
  if (!Number.isFinite(truePeakDbfs)) findings.push("True peak could not be measured.");
  else if (truePeakDbfs > profile.truePeakDbfs + 0.2) findings.push(`True peak is ${truePeakDbfs.toFixed(1)} dBFS; ceiling is ${profile.truePeakDbfs.toFixed(1)} dBFS.`);
  if (!Number.isFinite(loudnessRangeLu)) findings.push("Loudness range could not be measured.");
  else if (loudnessRangeLu > profile.maxLoudnessRangeLu + 0.5) findings.push(`Loudness range is ${loudnessRangeLu.toFixed(1)} LU; maximum is ${profile.maxLoudnessRangeLu.toFixed(1)} LU.`);
  return { status: findings.length ? "FAILED" : "PASSED", findings };
}

export function safeBroadcastProcessingProfile(profile) {
  return {
    id: profile.id,
    name: profile.name,
    purpose: profile.purpose,
    status: profile.status,
    codec: profile.codec,
    bitrateKbps: profile.bitrateKbps,
    sampleRateHz: profile.sampleRateHz,
    targetLufs: profile.targetLufs,
    truePeakDbfs: profile.truePeakDbfs,
    maxLoudnessRangeLu: profile.maxLoudnessRangeLu,
    highpassHz: profile.highpassHz,
    lowpassHz: profile.lowpassHz,
    compressionThresholdDb: profile.compressionThresholdDb,
    compressionRatio: profile.compressionRatio,
    compressionAttackMs: profile.compressionAttackMs,
    compressionReleaseMs: profile.compressionReleaseMs,
    limiterEnabled: profile.limiterEnabled,
    version: profile.version,
    updatedAt: profile.updatedAt
  };
}
