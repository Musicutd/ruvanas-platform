import Link from "next/link";
import { requireSubscriberProduct } from "@/lib/subscriber-product-access";
import ProductChannelSetupClient from "../../ProductChannelSetupClient";
import styles from "../../product-dashboard.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Faith channel setup | Ruvanas" };

export default async function FaithChannelSetup() {
  const { context } = await requireSubscriberProduct("FAITH", { stations: { where: { productFamily: "FAITH" }, include: { channels: true }, orderBy: { createdAt: "asc" } } });
  return <main className={styles.page} id="main-content"><header className={styles.heroCopy}><p className={styles.eyebrow}>RUVANAS FAITH · CHANNEL SETUP</p><h1>Set up continuous and live-service listening</h1><p>Create subscriber-owned faith channels and choose internal, restricted or public listening. <Link href="/dashboard/faith">Back to Faith</Link></p></header><div style={{ marginTop: 20 }}><ProductChannelSetupClient product="FAITH" initialStations={context.membership.organisation.stations} /></div></main>;
}
