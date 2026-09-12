import Link from "next/link";
import { requireSubscriberProduct } from "@/lib/subscriber-product-access";
import ProductChannelSetupClient from "../../ProductChannelSetupClient";
import styles from "../../product-dashboard.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organisation channel setup | Ruvanas" };

export default async function OrganisationChannelSetup() {
  const { context } = await requireSubscriberProduct("ORGANISATIONS", { stations: { where: { productFamily: "ORGANISATIONS" }, include: { channels: true }, orderBy: { createdAt: "asc" } } });
  return <main className={styles.page} id="main-content"><header className={styles.heroCopy}><p className={styles.eyebrow}>RUVANAS ORGANISATIONS · CHANNEL SETUP</p><h1>Create channels your organisation operates</h1><p>Choose internal, restricted or public listening. Ruvanas provides the platform and does not operate the channel. <Link href="/dashboard/organisations">Back to Organisations</Link></p></header><div style={{ marginTop: 20 }}><ProductChannelSetupClient product="ORGANISATIONS" initialStations={context.membership.organisation.stations} /></div></main>;
}
