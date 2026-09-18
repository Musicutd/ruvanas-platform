import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import SkipLink from "@/app/components/SkipLink";
import ContextHelp from "@/app/components/ContextHelp";

export const dynamic = "force-dynamic";
export const metadata = { title: "Station setup status | Ruvanas" };

export default async function StationSetupPage({ params }) {
  const context = await getActiveOrganisationContext();
  if (!context?.membership) redirect("/login");
  const { stationId } = await params;
  const station = await prisma.station.findFirst({
    where: { id: stationId, organisationId: context.membership.organisationId },
    select: { id: true, name: true, status: true, streamConfig: { select: { id: true } } }
  });
  if (!station) notFound();

  return <main style={styles.page}><SkipLink /><section style={styles.card} id="main-content">
    <Link href={`/stations/${station.id}`} style={styles.link}>← Back to station</Link>
    <p style={styles.eyebrow}>ONLINE RADIO · STREAMING</p>
    <h1 style={styles.title}>{station.name}</h1>
    <p style={styles.copy}>{station.status === "ACTIVE"
      ? "The station is active. Ruvanas Super Admin manages its private streaming connection."
      : station.streamConfig
        ? "The stream connection has been entered. Ruvanas Super Admin must verify the live source and activate the station."
        : "Ruvanas Super Admin will enter the private streaming details, verify the live source and activate the station."}</p>
    <p style={styles.note}>You do not need to enter provider usernames, passwords, hostnames or ports here. The public player will be available after the station is active and you publish it.</p>
    <Link href={`/stations/${station.id}/public-player`} style={styles.link}>Review public player settings →</Link>
    <ContextHelp title="Station setup" introduction="Ruvanas prepares and verifies the private stream. You can work on station branding and programming while it is pending." items={[{ title: "Who connects the stream?", description: "Only Ruvanas Super Admin can enter provider credentials and activate the station after a live check." }]} articleHref="/dashboard/help#station-setup" articleLabel="Open station setup help" />
  </section></main>;
}

const styles = {
  page: { minHeight: "100vh", padding: "48px 20px", background: "#101827", color: "#fff", fontFamily: "Arial, sans-serif" },
  card: { maxWidth: 660, margin: "0 auto", padding: 32, border: "1px solid #34445e", borderRadius: 16, background: "#182235" },
  link: { color: "#f4b942", fontWeight: 800 },
  eyebrow: { marginTop: 40, color: "#f4b942", fontSize: 12, fontWeight: 800, letterSpacing: 1 },
  title: { fontSize: 34 },
  copy: { fontSize: 18, lineHeight: 1.6 },
  note: { margin: "20px 0 28px", color: "#bac6d8", lineHeight: 1.6 }
};
