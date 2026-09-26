import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { audioPillar, firstListenablePillarStation, pillarListenHref, secureListenerUrl } from "@/lib/pillar-audio.mjs";
import { requireSubscriberProduct } from "@/lib/subscriber-product-access";
import styles from "../../radio/listen/radio-listen.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Listen live | Ruvanas" };

export default async function PillarListenPage({ params, searchParams }) {
  const { product: slug } = await params;
  const product = slug.toUpperCase();
  const pillar = audioPillar(product);
  if (!pillar) notFound();

  const { context } = await requireSubscriberProduct(product);
  const stations = await prisma.station.findMany({
    where: { organisationId: context.membership.organisationId, productFamily: product },
    select: { id: true, name: true, slug: true, productFamily: true, status: true, publicPlayerEnabled: true, streamConfig: { select: { streamUrl: true } } },
    orderBy: { createdAt: "asc" }
  });
  const query = await searchParams;
  const requestedId = typeof query?.stationId === "string" ? query.stationId : null;
  const station = requestedId
    ? stations.find((item) => item.id === requestedId)
    : firstListenablePillarStation(stations, product) || stations[0] || null;
  if (requestedId && !station) notFound();

  const streamUrl = secureListenerUrl(station?.streamConfig?.streamUrl);
  const publicPlayerReady = station?.status === "ACTIVE" && station.publicPlayerEnabled;

  return <main className={styles.page} id="main-content">
    <Link href={pillar.dashboardHref} className={styles.back}>← {pillar.label}</Link>
    <section className={styles.card}>
      <p className={styles.eyebrow}>{pillar.label.toUpperCase()} · LISTEN LIVE</p>
      <h1>{station?.name || `Listen to ${pillar.label}`}</h1>
      {streamUrl ? <>
        <p>Press play to check this channel’s live HTTPS listener output. Keep this tab open while working elsewhere in Ruvanas.</p>
        <audio className={styles.player} controls preload="none" src={streamUrl} referrerPolicy="no-referrer" aria-label={`Listen to ${station.name}`}>
          Your browser does not support audio playback.
        </audio>
        <a className={styles.directLink} href={streamUrl} target="_blank" rel="noopener noreferrer">Open secure stream directly ↗</a>
        {publicPlayerReady ? <p className={styles.notice}>The public player is available at <Link href={`/listen/${encodeURIComponent(station.slug)}`} target="_blank" rel="noopener noreferrer">the listener page ↗</Link>.</p>
          : <p className={styles.notice}>This is a signed-in listening check. It does not activate the station or publish a public player.</p>}
      </> : <>
        <p className={styles.notice}>No HTTPS browser-listening stream is ready for this {pillar.label} channel yet. Ruvanas Super Admin adds the streaming details. This page does not change AutoDJ or any schedule.</p>
        {product === "RETAIL" ? <p>Shop players may still play through their protected device connection. <Link href="/dashboard/players">Check your shop players →</Link></p> : null}
      </>}
      <p><Link href={pillar.autoDjHref}>Open AutoDJ settings →</Link></p>
    </section>
    {stations.length > 1 ? <nav className={styles.stations} aria-label={`${pillar.label} channels`}>
      <h2>Other channels</h2>
      {stations.filter((item) => item.id !== station?.id).map((item) => <Link key={item.id} href={pillarListenHref(product, item.id)}>{item.name}{secureListenerUrl(item.streamConfig?.streamUrl) ? " · listen" : " · setup needed"}</Link>)}
    </nav> : null}
  </main>;
}
