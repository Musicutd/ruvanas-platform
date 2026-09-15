import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/requireAdmin";
import { safeDistributorConnection } from "@/lib/music-distributor-service";
import MusicDistributorConsole from "./MusicDistributorConsole";

export const dynamic = "force-dynamic";
export const metadata = { title: "Music distributors | Ruvanas Administration" };

function serializable(value) { return JSON.parse(JSON.stringify(value)); }

export default async function MusicDistributorsPage() {
  const user = await getAdminUser();
  if (!user) redirect("/login");
  if (user.role !== "SUPER_ADMIN") redirect("/admin");
  const connections = await prisma.musicDistributorConnection.findMany({
    include: {
      _count: { select: { releases: true, tracks: true, collections: true, syncRuns: true, usageDeliveries: true } },
      tracks: { select: { id: true, externalTrackId: true, isrc: true, title: true, artist: true, minimumCatalogueLevel: true, permittedTerritories: true, permittedUses: true, status: true, takenDownAt: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 25 },
      syncRuns: { select: { id: true, kind: true, status: true, tracksReceived: true, createdCount: true, updatedCount: true, takenDownCount: true, rejectedCount: true, attempt: true, safeErrorCode: true, startedAt: true, completedAt: true, nextRetryAt: true }, orderBy: { createdAt: "desc" }, take: 8 },
      usageDeliveries: { select: { id: true, periodFrom: true, periodUntil: true, status: true, eventCount: true, attemptCount: true, deliveredAt: true, lastErrorCode: true }, orderBy: { createdAt: "desc" }, take: 8 },
      reconciliation: { select: { id: true, externalTrackId: true, action: true, occurredAt: true }, orderBy: { occurredAt: "desc" }, take: 8 }
    },
    orderBy: { createdAt: "desc" }
  });
  return <main style={styles.page}>
    <p style={styles.eyebrow}>PLATFORM CATALOGUE · PROVIDER CONTROL</p>
    <h1 style={styles.title}>Music distributors</h1>
    <p style={styles.description}>Connect an approved distributor through OAuth 2.0 client credentials, import a rights-aware catalogue, apply tier and territory rules, process takedowns and deliver privacy-safe usage evidence.</p>
    <div style={styles.notice}><strong>Inactive by default.</strong> New connections stay in Draft until authentication and the distributor contract have been checked. Credentials and delivery URLs are encrypted and never returned to this page.</div>
    <MusicDistributorConsole initialConnections={serializable(connections.map(safeDistributorConnection))} />
  </main>;
}

const styles = {
  page: { maxWidth: 1240, margin: "0 auto", padding: "40px 16px 72px", color: "#172033" },
  eyebrow: { margin: "0 0 8px", color: "#9a6400", fontSize: 12, fontWeight: 900, letterSpacing: 1.1 },
  title: { margin: 0, fontSize: 34, fontWeight: 950 },
  description: { maxWidth: 900, margin: "10px 0 16px", color: "#475569", lineHeight: 1.6 },
  notice: { marginBottom: 24, padding: 14, border: "1px solid #f0b429", borderRadius: 9, background: "#fff8e6", color: "#6b4700", lineHeight: 1.5 }
};
