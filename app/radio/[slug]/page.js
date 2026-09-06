import Link from "next/link";
import { notFound } from "next/navigation";
import { loadPublicStationWebsiteBySlug } from "@/lib/station-website-service";
import PwaLifecycle from "@/app/components/PwaLifecycle";
import NowPlaying from "./NowPlaying";
import styles from "./station-website.module.css";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const website = await loadPublicStationWebsiteBySlug(String(params.slug || "").toLowerCase());
  if (!website) return { title: "Station unavailable | Ruvanas", robots: { index: false, follow: false } };
  return {
    title: `${website.name} | Live radio`,
    description: website.tagline || website.description || `Listen live and discover programmes from ${website.name}.`,
    alternates: { canonical: `/radio/${website.slug}` },
    manifest: `/api/public/station-websites/${website.slug}/manifest`,
    appleWebApp: { capable: true, title: website.name, statusBarStyle: "black-translucent" },
    openGraph: {
      title: website.name,
      description: website.tagline || website.description || `Listen live to ${website.name}.`,
      type: "website",
      images: website.heroImageUrl || website.logoUrl ? [{ url: website.heroImageUrl || website.logoUrl }] : []
    }
  };
}

export default async function StationWebsitePage({ params }) {
  const website = await loadPublicStationWebsiteBySlug(String(params.slug || "").toLowerCase());
  if (!website) notFound();
  const accent = website.accent || "#f4b942";
  const schema = {
    "@context": "https://schema.org",
    "@type": "RadioStation",
    name: website.name,
    description: website.description || website.tagline || undefined,
    url: `/radio/${website.slug}`,
    parentOrganization: { "@type": "Organization", name: website.organisation.name }
  };
  return <main className={styles.page} data-theme={website.theme.toLowerCase()} style={{ "--station-accent": accent }}>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replaceAll("<", "\\u003c") }} />
    <header className={styles.header}>
      <Link className={styles.brand} href={`/radio/${website.slug}`}>
        {website.logoUrl ? <img src={website.logoUrl} alt="" /> : <span>{website.name.slice(0, 1).toUpperCase()}</span>}
        <strong>{website.name}</strong>
      </Link>
      <nav aria-label="Station navigation">
        {website.about ? <a href="#about">About</a> : null}
        {website.podcasts.length ? <a href="#podcasts">Podcasts</a> : null}
        {website.contactEmail || website.links.length ? <a href="#connect">Connect</a> : null}
        {website.playerEnabled ? <Link className={styles.headerListen} href={`/listen/${website.slug}`}>Listen live</Link> : null}
      </nav>
    </header>

    <section className={styles.hero}>
      {website.heroImageUrl ? <div className={styles.heroImage} style={{ backgroundImage: `linear-gradient(90deg, rgba(6,12,23,.92), rgba(6,12,23,.24)), url(${JSON.stringify(website.heroImageUrl).slice(1, -1)})` }} /> : <div className={styles.heroPattern} />}
      <div className={styles.heroContent}>
        <p className={styles.eyebrow}>LIVE RADIO · {website.organisation.name}</p>
        <h1>{website.headline}</h1>
        <p className={styles.lead}>{website.tagline || website.description || "Music, programmes and stories—live from our station."}</p>
        <div className={styles.heroActions}>
          {website.playerEnabled ? <Link className={styles.primaryButton} href={`/listen/${website.slug}`}><span className={styles.playIcon}>▶</span> Listen live</Link> : null}
          {website.podcasts.length ? <a className={styles.secondaryButton} href="#podcasts">Explore podcasts</a> : null}
        </div>
      </div>
      {website.showNowPlaying && website.playerEnabled ? <NowPlaying slug={website.slug} stationName={website.name} accent={accent} /> : null}
    </section>

    {website.about ? <section className={styles.about} id="about">
      <p className={styles.sectionNumber}>01</p>
      <div><p className={styles.eyebrow}>ABOUT THE STATION</p><h2>A station with something to say.</h2></div>
      <p className={styles.aboutCopy}>{website.about}</p>
    </section> : null}

    {website.podcasts.length ? <section className={styles.podcastSection} id="podcasts">
      <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>ON DEMAND</p><h2>Listen beyond the live broadcast.</h2></div><p>Latest programmes, conversations and station originals.</p></div>
      <div className={styles.podcastGrid}>{website.podcasts.map((podcast) => <article key={podcast.id} className={styles.podcastCard}>
        {podcast.artworkUrl ? <img src={podcast.artworkUrl} alt="" /> : <div className={styles.podcastFallback}>{podcast.title.slice(0, 1).toUpperCase()}</div>}
        <div><p className={styles.cardLabel}>PODCAST</p><h3>{podcast.title}</h3><p>{podcast.description || (podcast.latestEpisode ? `Latest: ${podcast.latestEpisode.title}` : "Listen to this station podcast.")}</p><div className={styles.cardLinks}><Link href={podcast.url}>Open series →</Link><a href={podcast.rssUrl}>RSS</a></div></div>
      </article>)}</div>
    </section> : null}

    {website.contactEmail || website.links.length ? <section className={styles.connect} id="connect">
      <div><p className={styles.eyebrow}>STAY CONNECTED</p><h2>Keep the station close.</h2><p>Follow, listen and get in touch with the team behind {website.name}.</p></div>
      <div className={styles.connectLinks}>
        {website.contactEmail ? <a href={`mailto:${website.contactEmail}`}>Email the station</a> : null}
        {website.links.map((link) => <a href={link.url} key={`${link.label}-${link.url}`} rel="noreferrer" target="_blank">{link.label}</a>)}
      </div>
    </section> : null}

    <footer className={styles.footer}><div><strong>{website.name}</strong><span>{website.tagline || "Live radio, wherever you are."}</span></div><div><span>High-quality audio delivery by Ruvanas</span><span>A 21-Three platform</span></div></footer>
    <PwaLifecycle stationPath={`/radio/${website.slug}`} />
  </main>;
}
