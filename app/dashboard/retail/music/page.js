import Link from "next/link";
import { requireSubscriberProduct } from "@/lib/subscriber-product-access";
import RetailMusicSetup from "./RetailMusicSetup";
import styles from "./retail-music.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Music for shops | Ruvanas" };

export default async function RetailMusicPage() {
  await requireSubscriberProduct("RETAIL");

  return <main className={styles.page} id="main-content">
    <div className={styles.shell}>
      <div className={styles.topLinks}>
        <Link href="/dashboard/retail">← Retail dashboard</Link>
        <Link href="/dashboard/programming">Advanced programming →</Link>
      </div>
      <header className={styles.hero}>
        <p className={styles.eyebrow}>RETAIL MUSIC</p>
        <h1>Music for your shops, made simple</h1>
        <p>Choose where music should play, select approved music, and decide when it should run. Detailed schedules and AutoDJ controls are still available when you need them.</p>
      </header>
      <RetailMusicSetup />
    </div>
  </main>;
}
