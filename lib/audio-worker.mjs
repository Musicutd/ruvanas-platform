import { clipDuration } from "./waveform-editor.mjs";
import { normalizeMultitrackState } from "./multitrack-studio.mjs";

function seconds(milliseconds) {
  return (Math.max(0, Number(milliseconds)) / 1000).toFixed(3);
}

function fadeCurve(value) {
  return value === "log" ? "log" : value === "exp" ? "exp" : "tri";
}

export function buildRenderGraph(clips, settings = {}) {
  if (!Array.isArray(clips) || clips.length === 0) throw new Error("The project has no audio clips to render.");
  const ordered = [...clips].sort((left, right) => left.timelineStartMs - right.timelineStartMs);
  const inputs = [];
  const filters = [];
  const labels = [];
  let sourceIndex = 0;
  ordered.forEach((clip, clipIndex) => {
    const duration = clipDuration(clip);
    const label = `c${clipIndex}`;
    labels.push(`[${label}]`);
    if (clip.kind === "SILENCE") {
      filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${seconds(duration)},asetpts=PTS-STARTPTS[${label}]`);
      return;
    }
    inputs.push({ mediaAssetId: clip.mediaAssetId, sourceIndex });
    const chain = [
      `[${sourceIndex}:a]atrim=start=${seconds(clip.sourceStartMs)}:end=${seconds(clip.sourceEndMs)}`,
      "asetpts=PTS-STARTPTS",
      "aresample=48000",
      "aformat=sample_fmts=fltp:channel_layouts=stereo"
    ];
    if (Number(clip.gainDb)) chain.push(`volume=${Number(clip.gainDb).toFixed(2)}dB`);
    if (clip.fadeInMs > 0) chain.push(`afade=t=in:st=0:d=${seconds(Math.min(clip.fadeInMs, duration))}:curve=${fadeCurve(clip.fadeInCurve)}`);
    if (clip.fadeOutMs > 0) chain.push(`afade=t=out:st=${seconds(Math.max(0, duration - clip.fadeOutMs))}:d=${seconds(Math.min(clip.fadeOutMs, duration))}:curve=${fadeCurve(clip.fadeOutCurve)}`);
    filters.push(`${chain.join(",")}[${label}]`);
    sourceIndex += 1;
  });
  const finalChain = [];
  if (settings.noiseCleanup) finalChain.push("afftdn=nf=-25");
  if (settings.normalize !== false) finalChain.push(`loudnorm=I=${Number(settings.targetLufs || -16)}:TP=-1.5:LRA=11`);
  filters.push(`${labels.join("")}concat=n=${labels.length}:v=0:a=1${finalChain.length ? `,${finalChain.join(",")}` : ""}[outa]`);
  return { inputs, filterComplex: filters.join(";"), outputLabel: "[outa]" };
}

function trackPanFilter(pan) {
  const value = Math.max(-1, Math.min(1, Number(pan) || 0));
  const left = value > 0 ? 1 - value : 1;
  const right = value < 0 ? 1 + value : 1;
  return `pan=stereo|c0=${left.toFixed(3)}*c0|c1=${right.toFixed(3)}*c1`;
}

function presetFilters(preset) {
  if (preset === "SPEECH_CLEANUP") return ["highpass=f=80", "lowpass=f=12000", "afftdn=nf=-28"];
  if (preset === "PODCAST_VOICE") return ["highpass=f=70", "acompressor=threshold=-18dB:ratio=3:attack=10:release=160"];
  if (preset === "RADIO_VOICE") return ["highpass=f=90", "acompressor=threshold=-20dB:ratio=4:attack=8:release=120", "alimiter=limit=0.92"];
  return [];
}

function automationFilters(points) {
  return points.map((point, index) => {
    const next = points[index + 1];
    const end = next ? seconds(next.timeMs) : "86400";
    return `volume=${Number(point.value).toFixed(2)}dB:enable='between(t,${seconds(point.timeMs)},${end})'`;
  });
}

export function buildMultitrackRenderGraph(value) {
  const state = normalizeMultitrackState(value);
  const soloed = state.tracks.some((track) => track.solo && !track.muted);
  const activeTracks = state.tracks.filter((track) => !track.muted && (!soloed || track.solo) && track.clips.length);
  if (!activeTracks.length) throw new Error("The multitrack project has no audible clips to render.");

  const inputs = [];
  const filters = [];
  const buses = { voice: [], music: [], other: [] };
  let sourceIndex = 0;
  for (const [trackIndex, track] of activeTracks.entries()) {
    const clipLabels = [];
    for (const [clipIndex, clip] of track.clips.entries()) {
      const duration = clipDuration(clip);
      const label = `t${trackIndex}c${clipIndex}`;
      inputs.push({ mediaAssetId: clip.mediaAssetId, sourceIndex });
      const chain = [
        `[${sourceIndex}:a]atrim=start=${seconds(clip.sourceStartMs)}:end=${seconds(clip.sourceEndMs)}`,
        "asetpts=PTS-STARTPTS",
        "aresample=48000",
        "aformat=sample_fmts=fltp:channel_layouts=stereo"
      ];
      if (Number(clip.gainDb)) chain.push(`volume=${Number(clip.gainDb).toFixed(2)}dB`);
      if (clip.fadeInMs > 0) chain.push(`afade=t=in:st=0:d=${seconds(Math.min(clip.fadeInMs, duration))}:curve=${fadeCurve(clip.fadeInCurve)}`);
      if (clip.fadeOutMs > 0) chain.push(`afade=t=out:st=${seconds(Math.max(0, duration - clip.fadeOutMs))}:d=${seconds(Math.min(clip.fadeOutMs, duration))}:curve=${fadeCurve(clip.fadeOutCurve)}`);
      if (clip.timelineStartMs > 0) chain.push(`adelay=${Math.round(clip.timelineStartMs)}|${Math.round(clip.timelineStartMs)}`);
      filters.push(`${chain.join(",")}[${label}]`);
      clipLabels.push(`[${label}]`);
      sourceIndex += 1;
    }
    const mixedLabel = `t${trackIndex}mix`;
    const mix = clipLabels.length === 1 ? `${clipLabels[0]}anull` : `${clipLabels.join("")}amix=inputs=${clipLabels.length}:duration=longest:normalize=0`;
    const chain = [
      ...presetFilters(track.preset),
      ...(Number(track.gainDb) ? [`volume=${Number(track.gainDb).toFixed(2)}dB`] : []),
      ...(Number(track.pan) ? [trackPanFilter(track.pan)] : []),
      ...automationFilters(track.automation)
    ];
    filters.push(`${mix}${chain.length ? `,${chain.join(",")}` : ""}[${mixedLabel}]`);
    const target = track.kind === "VOICE" ? "voice" : track.kind === "MUSIC" ? "music" : "other";
    buses[target].push(`[${mixedLabel}]`);
  }

  const mixBus = (labels, name) => {
    if (!labels.length) return null;
    if (labels.length === 1) return labels[0];
    filters.push(`${labels.join("")}amix=inputs=${labels.length}:duration=longest:normalize=0[${name}]`);
    return `[${name}]`;
  };
  const voice = mixBus(buses.voice, "voicebus");
  const music = mixBus(buses.music, "musicbus");
  const other = mixBus(buses.other, "otherbus");
  const finalInputs = [];
  if (state.ducking.enabled && voice && music) {
    const duckingRatio = Math.max(2, Math.min(20, Math.abs(state.ducking.musicReductionDb) / 2)).toFixed(1);
    filters.push(`${voice}asplit=2[voiceprogram][voicekey]`);
    filters.push(`${music}[voicekey]sidechaincompress=threshold=0.02:ratio=${duckingRatio}:attack=${state.ducking.attackMs}:release=${state.ducking.releaseMs}:makeup=1[duckedmusic]`);
    finalInputs.push("[duckedmusic]", "[voiceprogram]");
  } else {
    if (music) finalInputs.push(music);
    if (voice) finalInputs.push(voice);
  }
  if (other) finalInputs.push(other);
  const final = finalInputs.length === 1 ? `${finalInputs[0]}anull` : `${finalInputs.join("")}amix=inputs=${finalInputs.length}:duration=longest:normalize=0`;
  const master = [];
  if (state.master.normalize) master.push(`loudnorm=I=${state.master.targetLufs}:TP=-1.5:LRA=11`);
  if (state.master.limiter) master.push("alimiter=limit=0.95");
  filters.push(`${final}${master.length ? `,${master.join(",")}` : ""}[outa]`);
  return { inputs, filterComplex: filters.join(";"), outputLabel: "[outa]", state };
}

export function reducePcmPeaks(buffer, maxPeaks = 1200) {
  const sampleCount = Math.floor(buffer.length / 2);
  if (!sampleCount) return [];
  const bucketSize = Math.max(1, Math.ceil(sampleCount / maxPeaks));
  const peaks = [];
  for (let offset = 0; offset < sampleCount; offset += bucketSize) {
    let peak = 0;
    const end = Math.min(sampleCount, offset + bucketSize);
    for (let index = offset; index < end; index += 1) {
      peak = Math.max(peak, Math.abs(buffer.readInt16LE(index * 2)) / 32768);
    }
    peaks.push(Number(Math.min(1, peak).toFixed(4)));
  }
  return peaks;
}

export function parseLoudnessReport(output) {
  const integratedMatches = [...String(output).matchAll(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g)];
  const peakMatches = [...String(output).matchAll(/Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/g)];
  const rangeMatches = [...String(output).matchAll(/LRA:\s*(\d+(?:\.\d+)?)\s*LU/g)];
  const last = (matches) => matches.length ? Number(matches.at(-1)[1]) : null;
  return { integratedLufs: last(integratedMatches), truePeakDbfs: last(peakMatches), loudnessRangeLu: last(rangeMatches) };
}
