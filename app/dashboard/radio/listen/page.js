import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { firstListenableOnlineStation, onlineRadioListenHref, secureRadioListenerUrl } from "@/lib/online-radio-listen.mjs";
import { requireSubscriberProduct } from "@/lib/subscriber-product-access";
import styles from "./radio-listen.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Listen to your station | Ruvanas" };

export default async function OnlineRadioListenPage({ searchParams }) {
  const { context } = await requireSubscriberProduct("ONLINE");
  const organisationId = context.membership.organisation.id;
  const stations = await prisma.station.findMany({
    where: { organisationId, productFamily: "ONLINE" },
    select: { id: true, name: true, slug: true, status: true, publicPlayerEnabled: true, streamConfig: { select: { streamUrl: true } } },
    orderBy: { createdAt: "asc" }
  });
  const query = await searchParams;
  const requestedId = typeof query?.stationId === "string" ? query.stationId : null;
  const station = requestedId
    ? stations.find((item) => item.id === requestedId)
    : firstListenableOnlineStation(stations) || stations[0];
  if (requestedId && !station) notFound();
  const streamUrl = secureRadioListenerUrl(station?.streamConfig?.streamUrl);
  const publicPlayerReady = station?.status === "ACTIVE" && station.publicPlayerEnabled;

  return <main className={styles.page} id="main-content">
    <Link href="/dashboard/radio" className={styles.back}>← Online Radio dashboard</Link>
    <section className={styles.card}>
      <p className={styles.eyebrow}>LISTEN TO YOUR STATION</p>
      <h1>{station?.name || "Your Online Radio station"}</h1>
      {streamUrl ? <>
        <p>Press play to hear the configured listener stream. You can keep this tab open while working elsewhere in Ruvanas.</p>
        <audio className={styles.player} controls preload="none" src={streamUrl} referrerPolicy="no-referrer" aria-label={`Listen to ${station.name}`}>
          Your browser does not support audio playback.
        </audio>
        <a className={styles.directLink} href={streamUrl} target="_blank" rel="noopener noreferrer">Open secure stream directly ↗</a>
        {!publicPlayerReady ? <p className={styles.notice}>This is a signed-in test listening page. It does not activate the station or publish its Ruvanas public player.</p> : <p className={styles.notice}>Your public player is available at <Link href={`/listen/${encodeURIComponent(station.slug)}`} target="_blank" rel="noopener noreferrer">the listener page ↗</Link>.</p>}
      </> : <p className={styles.notice}>No secure listener stream is configured for this station yet. Ask Ruvanas Super Admin to add its HTTPS listener URL.</p>}
    </section>
    {stations.length > 1 ? <nav className={styles.stations} aria-label="Your Online Radio stations">
      <h2>Other stations</h2>
      {stations.filter((item) => item.id !== station?.id).map((item) => <Link key={item.id} href={onlineRadioListenHref(item.id)}>{item.name}</Link>)}
    </nav> : null}
  </main>;
}
