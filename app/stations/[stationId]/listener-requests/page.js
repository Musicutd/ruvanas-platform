import { notFound, redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ListenerRequestWorkspace from "./ListenerRequestWorkspace";
import styles from "./listener-requests.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Listener requests | Ruvanas" };

export default async function ListenerRequestsPage({ params }) {
  const context = await getActiveOrganisationContext();
  if (!context?.membership) redirect("/login");
  const station = await prisma.station.findFirst({ where: { id: params.stationId, organisationId: context.membership.organisationId }, select: { id: true, name: true, listenerRequestsEnabled: true } });
  if (!station) notFound();
  if (!["OWNER", "MANAGER", "CONTENT_EDITOR"].includes(context.membership.role)) redirect(`/stations/${station.id}`);
  return <main className={styles.page}><section className={styles.shell}>
    <a href={`/stations/${station.id}/public-player`} className={styles.back}>← Public player settings</a>
    <p className={styles.eyebrow}>AUDIENCE</p>
    <h1>Listener requests</h1>
    <p className={styles.intro}>Review song suggestions before they influence any editorial decision. Approved requests remain separate from the live schedule until your team chooses and clears the music.</p>
    {!station.listenerRequestsEnabled ? <p className={styles.warning}>Song requests are currently switched off for this station.</p> : null}
    <ListenerRequestWorkspace stationId={station.id} canBlock={["OWNER", "MANAGER"].includes(context.membership.role)} />
  </section></main>;
}
