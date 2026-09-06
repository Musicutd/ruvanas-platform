import { notFound, redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import PublicPlayerSettings from "./PublicPlayerSettings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Public player | Ruvanas" };

export default async function PublicPlayerSettingsPage({ params }) {
  const context = await getActiveOrganisationContext();
  if (!context?.membership) redirect("/login");
  const station = await prisma.station.findFirst({ where: { id: params.stationId, organisationId: context.membership.organisationId }, select: { id: true, name: true, slug: true, status: true, publicPlayerEnabled: true, publicPlayerTagline: true, publicPlayerAccent: true, listenerRequestsEnabled: true, listenerRequestInstructions: true, listenerLimit: true } });
  if (!station) notFound();
  const canManage = ["OWNER", "MANAGER"].includes(context.membership.role);
  return <main style={styles.page}><section style={styles.shell}>
    <a href={`/stations/${station.id}`} style={styles.back}>← Back to station</a>
    <p style={styles.eyebrow}>ONLINE RADIO</p>
    <h1 style={styles.heading}>Public player</h1>
    <p style={styles.copy}>Publish a professional, anonymous listening page and an embeddable player without exposing private station controls or source credentials.</p>
    <PublicPlayerSettings station={station} canManage={canManage} />
  </section></main>;
}

const styles = {
  page: { minHeight: "100vh", background: "#0b1322", color: "#f8fafc", fontFamily: "Arial, sans-serif", padding: "48px 20px" },
  shell: { width: "min(900px, 100%)", margin: "0 auto" },
  back: { color: "#cbd5e1", textDecoration: "none" },
  eyebrow: { color: "#f4b942", letterSpacing: 1.5, fontWeight: 800, fontSize: 12, marginTop: 42 },
  heading: { fontSize: "clamp(38px, 7vw, 64px)", margin: "8px 0 14px" },
  copy: { color: "#bac6d8", lineHeight: 1.65, fontSize: 18, maxWidth: 720 }
};
