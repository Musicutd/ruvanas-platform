import Link from "next/link";
import { notFound } from "next/navigation";
import { loadPublicPodcastSeries } from "@/lib/public-podcast";
import PwaLifecycle from "@/app/components/PwaLifecycle";
import styles from "./podcast.module.css";

export const dynamic = "force-dynamic";

function duration(value) {
  const seconds = Number(value) || 0;
  if (!seconds) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes} min`;
}

export async function generateMetadata({ params }) {
  const { organisationSlug, feedSlug } = await params;
  const publication = await loadPublicPodcastSeries(organisationSlug, feedSlug);
  return publication ? {
    title: `${publication.series.title} | Ruvanas Podcasts`,
    description: publication.series.description || `Listen to ${publication.series.title}.`,
    ...(publication.series.station.stationWebsiteEnabled ? { manifest: `/api/public/station-websites/${publication.series.station.slug}/manifest`, appleWebApp: { capable: true, title: publication.series.station.name, statusBarStyle: "black-translucent" } } : {})
  } : { title: "Podcast | Ruvanas" };
}

export default async function PublicPodcastPage({ params }) {
  const { organisationSlug, feedSlug } = await params;
  const publication = await loadPublicPodcastSeries(String(organisationSlug || "").toLowerCase(), String(feedSlug || "").toLowerCase());
  if (!publication) notFound();
  const rssPath = `/api/public/podcasts/${publication.organisation.slug}/${publication.series.feedSlug}/rss`;
  return <main className={styles.page}>
    <header className={styles.header}><Link href="/" className={styles.brand}>RUVANAS</Link><span>Part of 21-Three</span></header>
    <section className={styles.hero}>
      {publication.series.artworkUrl ? <img src={publication.series.artworkUrl} alt="" className={styles.artwork} /> : <div className={styles.artworkFallback}>R</div>}
      <div><p className={styles.eyebrow}>PODCAST · {publication.series.station.name}</p><h1>{publication.series.title}</h1><p className={styles.description}>{publication.series.description || "Original audio from this Ruvanas station."}</p><div className={styles.byline}>{publication.series.author || publication.organisation.name}{publication.series.channel ? ` · ${publication.series.channel.name}` : ""}</div><a className={styles.rss} href={rssPath}>RSS feed</a></div>
    </section>
    <section className={styles.episodes} aria-labelledby="episodes-title"><div className={styles.sectionHeading}><p className={styles.eyebrow}>LATEST RELEASES</p><h2 id="episodes-title">Episodes</h2></div>
      {publication.publicEpisodes.length ? publication.publicEpisodes.map((episode) => <article className={styles.episode} key={episode.id}>
        <div className={styles.meta}><time>{new Intl.DateTimeFormat("en", { day: "numeric", month: "long", year: "numeric" }).format(new Date(episode.publishedAt))}</time>{episode.durationSeconds ? <span>{duration(episode.durationSeconds)}</span> : null}{episode.explicit ? <span>Explicit</span> : null}</div>
        <h3>{episode.title}</h3><p>{episode.summary || episode.accessibleDescription || "Listen to this episode."}</p>
        <audio controls preload="none" src={episode.audioPath}>Your browser does not support podcast playback.</audio>
        {episode.chapters.length ? <details><summary>Chapters</summary><ol>{episode.chapters.map((chapter, index) => <li key={`${chapter.startMs}-${index}`}><span>{Math.floor(chapter.startMs / 60000)}:{String(Math.floor((chapter.startMs % 60000) / 1000)).padStart(2, "0")}</span>{chapter.title}</li>)}</ol></details> : null}
        {episode.transcript.length ? <details><summary>Transcript</summary><div className={styles.transcript}>{episode.transcript.map((segment, index) => <p key={`${segment.startMs}-${index}`}><strong>{segment.speaker ? `${segment.speaker}: ` : ""}</strong>{segment.text}</p>)}</div></details> : null}
      </article>) : <div className={styles.empty}>No public episodes are available yet.</div>}
    </section>
    <footer className={styles.footer}>High-quality audio delivery by Ruvanas · A 21-Three platform</footer>
    {publication.series.station.stationWebsiteEnabled ? <PwaLifecycle stationPath={`/radio/${publication.series.station.slug}`} /> : null}
  </main>;
}
