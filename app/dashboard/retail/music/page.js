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
        <Link href="/dashboard/retail">← Your shops</Link>
      </div>
      <header className={styles.hero}>
        <p className={styles.eyebrow}>SHOP MUSIC</p>
        <h1>Choose music for your shop</h1>
        <p>Pick a shop area and approved music. Automatic music follows shop hours by default, while published programmes keep priority.</p>
      </header>
      <RetailMusicSetup />
    </div>
  </main>;
}
