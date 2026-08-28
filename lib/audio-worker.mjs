import { clipDuration } from "./waveform-editor.mjs";

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

