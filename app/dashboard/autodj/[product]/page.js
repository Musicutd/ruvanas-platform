import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { audioPillar } from "@/lib/pillar-audio.mjs";
import { requireSubscriberProduct } from "@/lib/subscriber-product-access";
import PillarAutoDjWorkspace from "./PillarAutoDjWorkspace";
import styles from "./pillar-autodj.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "AutoDJ | Ruvanas" };

export default async function PillarAutoDjPage({ params }) {
  const { product: slug } = await params;
  const product = slug.toUpperCase();
  const pillar = audioPillar(product);
  if (!pillar) notFound();
  if (product === "RETAIL") redirect("/dashboard/retail/music");
  await requireSubscriberProduct(product);

  return <main className={styles.page} id="main-content">
    <Link href={pillar.dashboardHref} className={styles.back}>← {pillar.label}</Link>
    <header className={styles.hero}>
      <p className={styles.eyebrow}>{pillar.label.toUpperCase()} · AUTOMATIC MUSIC</p>
      <h1>Keep your channel playing with AutoDJ</h1>
      <p>Choose a channel, decide when approved music should play, then save. Your existing programmes and schedules keep their priority.</p>
    </header>
    <PillarAutoDjWorkspace product={product} rightsUse={pillar.rightsUse} />
    <p className={styles.advanced}>Need a detailed schedule? <Link href="/dashboard/programming#workspace-schedule">Open the existing schedule tools →</Link></p>
  </main>;
}
