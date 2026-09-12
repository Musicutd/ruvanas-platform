import Link from "next/link";
import { requireSubscriberProduct } from "@/lib/subscriber-product-access";
import ProductChannelSetupClient from "../../ProductChannelSetupClient";
import styles from "../../product-dashboard.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Health channel setup | Ruvanas" };

export default async function HealthChannelSetup() {
  const { context } = await requireSubscriberProduct("HEALTH", { stations: { where: { productFamily: "HEALTH" }, include: { channels: true }, orderBy: { createdAt: "asc" } } });
  return <main className={styles.page} id="main-content"><header className={styles.heroCopy}><p className={styles.eyebrow}>RUVANAS HEALTH · CHANNEL SETUP</p><h1>Set up listening without collecting clinical data</h1><p>Create subscriber-owned health channels, choose who may listen, and optionally enable minimal song requests. <Link href="/dashboard/health">Back to Health</Link></p></header><div style={{ marginTop: 20 }}><ProductChannelSetupClient product="HEALTH" initialStations={context.membership.organisation.stations} /></div></main>;
}
