import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSubscriberProduct } from "@/lib/subscriber-product-access";
import AdvancedSchedulerWorkspace from "@/app/dashboard/programming/AdvancedSchedulerWorkspace";
import styles from "@/app/dashboard/programming/programming.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Station schedule | Ruvanas" };

export default async function OnlineRadioStationSchedulePage({ params }) {
  const { context } = await requireSubscriberProduct("ONLINE");
  const { stationId } = await params;
  const station = await prisma.station.findFirst({
    where: { id: stationId, organisationId: context.membership.organisationId, productFamily: "ONLINE" },
    select: {
      id: true,
      name: true,
      status: true,
      streamConfig: { select: { streamUrl: true } },
      channels: { where: { status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } }
    }
  });
  if (!station) notFound();

  return <main className={styles.page}>
    <header className={styles.header}>
      <Link href="/dashboard/radio" className={styles.brand}>RUVANAS</Link>
      <Link href="/dashboard/radio" className={styles.back}>Back to Online Radio</Link>
    </header>
    <section className={styles.shell} id="main-content">
      <div className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>ONLINE RADIO · {station.name}</p>
          <h1>Draft your station programmes</h1>
          <p className={styles.intro}>Choose the active station channel, add a rights-approved Music Mode to a weekly programme, save a draft, preview it, then publish when ready. A retail location or zone is not required.</p>
        </div>
        <div className={styles.safetyNote}>
          <strong>Playback is separate</strong>
          <span>This programme schedule does not switch the dedicated Centova encoder's rotation. Set the channel's Continuous AutoDJ and ask Ruvanas to connect the broadcast source for live audio.</span>
        </div>
      </div>
      {!station.channels.length ? <div className={styles.emptyState} role="status">
        <strong>Channel setup is needed for {station.name}.</strong>{" "}
        {station.streamConfig?.streamUrl
          ? "The stream URL is saved, but the station has no active Ruvanas channel. Ask your Ruvanas Super Admin to open this station’s setup and choose Prepare Online Radio channel."
          : "Ask your Ruvanas Super Admin to save the stream connection and prepare the Online Radio channel."}
        {" "}<Link href="/dashboard/support">Contact Ruvanas support</Link>.
      </div> : <AdvancedSchedulerWorkspace stationId={station.id} />}
      {station.channels.length ? <p className={styles.panelIntro}><Link href="/dashboard/programming#workspace-schedule">Set Continuous AutoDJ</Link> after preparing the station schedule. The dedicated encoder must be connected before listeners hear audio.</p> : null}
    </section>
  </main>;
}
