export const PODCAST_PRODUCTS = Object.freeze({
  ONLINE_RADIO: "ONLINE_RADIO",
  SCHOOL_RADIO: "SCHOOL_RADIO"
});

export const PODCAST_CHAPTER_LIMIT = 100;
export const TRANSCRIPT_SEGMENT_LIMIT = 500;

function cleanText(value, maximum = 500) {
  return String(value || "").trim().slice(0, maximum);
}

export function podcastSlug(value, fallback = "podcast") {
  const slug = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || fallback;
}

export function normalizeTranscriptSegments(value) {
  const segments = Array.isArray(value) ? value : [];
  return segments.slice(0, TRANSCRIPT_SEGMENT_LIMIT).map((segment, index) => {
    const startMs = Math.max(0, Math.round(Number(segment?.startMs) || 0));
    const endMs = Math.max(startMs + 1, Math.round(Number(segment?.endMs) || startMs + 1));
    const text = cleanText(segment?.text, 2000);
    if (!text) throw new Error(`Transcript segment ${index + 1} needs text.`);
    return { startMs, endMs, text, speaker: cleanText(segment?.speaker, 80) || null };
  }).sort((left, right) => left.startMs - right.startMs);
}

export function normalizePodcastChapters(value) {
  const chapters = Array.isArray(value) ? value : [];
  return chapters.slice(0, PODCAST_CHAPTER_LIMIT).map((chapter, index) => {
    const startMs = Math.max(0, Math.round(Number(chapter?.startMs) || 0));
    const title = cleanText(chapter?.title, 160);
    if (!title) throw new Error(`Chapter ${index + 1} needs a title.`);
    return { startMs, title };
  }).sort((left, right) => left.startMs - right.startMs);
}

export function validateOnlinePodcastPublication({
  series,
  episode,
  approvedAudio,
  transcriptStatus = null,
  stationStatus = "ACTIVE"
} = {}) {
  if (!series || series.product !== PODCAST_PRODUCTS.ONLINE_RADIO) {
    throw new Error("Choose an Online Radio podcast series.");
  }
  if (!series.stationId) throw new Error("The podcast series needs a station before publication.");
  if (stationStatus !== "ACTIVE") throw new Error("The podcast station must be active before publication.");
  if (!series.feedSlug) throw new Error("The podcast series needs a public feed address.");
  if (!episode?.title?.trim()) throw new Error("The podcast episode needs a title.");
  if (!approvedAudio || approvedAudio.status !== "READY") {
    throw new Error("The episode needs approved, ready station audio before publication.");
  }
  if (approvedAudio.organisationId !== series.organisationId || episode.organisationId !== series.organisationId) {
    throw new Error("Podcast audio, episode and series must belong to the active organisation.");
  }
  if (transcriptStatus && transcriptStatus !== "APPROVED") {
    throw new Error("Submit or approve the transcript before publishing, or remove the draft transcript.");
  }
  return { status: "PUBLISHED", publicationScope: "PUBLIC", rssEnabled: true };
}

function xml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function absoluteUrl(origin, path) {
  return new URL(path, origin.endsWith("/") ? origin : `${origin}/`).toString();
}

export function buildPodcastRss({ origin, organisationSlug, series, episodes = [] } = {}) {
  const feedPath = `/podcasts/${organisationSlug}/${series.feedSlug}`;
  const items = episodes.map((episode) => {
    const audioPath = `/api/public/podcasts/${organisationSlug}/${series.feedSlug}/episodes/${episode.id}/audio`;
    const publishedAt = episode.publishedAt instanceof Date ? episode.publishedAt : new Date(episode.publishedAt);
    const duration = Math.max(0, Number(episode.mediaAsset?.durationSeconds) || 0);
    return [
      "    <item>",
      `      <title>${xml(episode.title)}</title>`,
      `      <description>${xml(episode.summary || episode.accessibleDescription || "")}</description>`,
      `      <guid isPermaLink="false">${xml(episode.id)}</guid>`,
      `      <pubDate>${publishedAt.toUTCString()}</pubDate>`,
      `      <enclosure url="${xml(absoluteUrl(origin, audioPath))}" length="${xml(episode.mediaAsset?.sizeBytes || 0)}" type="${xml(episode.mediaAsset?.mimeType || "audio/mpeg")}" />`,
      duration ? `      <itunes:duration>${duration}</itunes:duration>` : "",
      episode.explicit ? "      <itunes:explicit>true</itunes:explicit>" : "      <itunes:explicit>false</itunes:explicit>",
      "    </item>"
    ].filter(Boolean).join("\n");
  }).join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">',
    "  <channel>",
    `    <title>${xml(series.title)}</title>`,
    `    <link>${xml(absoluteUrl(origin, feedPath))}</link>`,
    `    <description>${xml(series.description || "")}</description>`,
    `    <language>${xml(series.languageCode || "en")}</language>`,
    `    <itunes:author>${xml(series.author || "Ruvanas")}</itunes:author>`,
    "    <itunes:explicit>false</itunes:explicit>",
    series.artworkUrl ? `    <itunes:image href="${xml(series.artworkUrl)}" />` : "",
    items,
    "  </channel>",
    "</rss>"
  ].filter(Boolean).join("\n");
}

export function publicPodcastEpisode(episode, { organisationSlug, feedSlug } = {}) {
  return {
    id: episode.id,
    title: episode.title,
    summary: episode.summary || null,
    accessibleDescription: episode.accessibleDescription || null,
    explicit: Boolean(episode.explicit),
    seasonNumber: episode.seasonNumber || null,
    episodeNumber: episode.episodeNumber || null,
    durationSeconds: episode.mediaAsset?.durationSeconds || null,
    chapters: Array.isArray(episode.chaptersJson) ? episode.chaptersJson : [],
    transcript: episode.transcript?.status === "APPROVED" && Array.isArray(episode.transcript.segmentsJson)
      ? episode.transcript.segmentsJson
      : [],
    publishedAt: episode.publishedAt,
    audioPath: `/api/public/podcasts/${organisationSlug}/${feedSlug}/episodes/${episode.id}/audio`
  };
}
