import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { correctionsRequestContext } from "@/lib/corrections-access";
import { correctionsNetworkAuthority } from "@/lib/corrections-network-service";
import { correctionsEdgeEffectiveStatus } from "@/lib/corrections-edge-status.mjs";
import styles from "../network/network.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Secure Edge | Ruvanas Inside" };

export default async function CorrectionsEdgePage() {
  const access = await correctionsRequestContext();
  if (!access.ok) notFound();
  try { await correctionsNetworkAuthority(prisma, access, "view"); }
  catch { notFound(); }
  const nodes = await prisma.correctionsEdgeNode.findMany({ where: { organisationId: access.organisationId },
    select: { id: true, name: true, status: true, lastSeenAt: true, lastSuccessfulSyncAt: true,
      syncStatus: true, storageHealth: true, cachedContentCount: true, pendingProofCount: true,
      softwareVersion: true, facility: { select: { name: true } }, manifests: { orderBy: { sequence: "desc" }, take: 1,
      select: { sequence: true, validUntil: true } } }, orderBy: { createdAt: "desc" }, take: 200 });
  const timestamp = (value) => value ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(value) : "Not yet";
  return <main className={styles.page}>
    <header className={styles.hero}><span className={styles.eyebrow}>Ruvanas Inside · Tier 4/5</span>
      <h1>Secure Edge fleet</h1><p>One protected local Edge per facility. This view reports machine and cache health—not whether a person listened.</p>
      <Link href="/dashboard/corrections/network">← Network operations</Link></header>
    <section className={styles.metrics} aria-label="Edge health summary">
      {["ONLINE", "DEGRADED", "OFFLINE", "REVOKED"].map((status) =>
        <article className={styles.metric} key={status}><span>{status.toLowerCase()} nodes</span>
          <strong>{nodes.filter((node) => correctionsEdgeEffectiveStatus(node) === status).length}</strong></article>)}
    </section>
    <section className={styles.card}><div className={styles.sectionHead}><div><span className={styles.eyebrow}>Facility-bound machines</span>
      <h2>Current Edge status</h2></div><span>Updated when this page loads</span></div>
      {!nodes.length ? <p>No Secure Edge has been enrolled. Ask Ruvanas Super Admin to prepare an Edge for a facility.</p> :
        <div className={styles.tableWrap}><table><thead><tr><th>Facility / Edge</th><th>Status</th><th>Last seen</th>
          <th>Last successful sync</th><th>Manifest</th><th>Cached items</th><th>Pending proof</th><th>Software</th></tr></thead>
          <tbody>{nodes.map((node) => <tr key={node.id}><th scope="row">{node.facility.name}<small>{node.name}</small></th>
            <td>{correctionsEdgeEffectiveStatus(node)}</td><td>{timestamp(node.lastSeenAt)}</td>
            <td>{timestamp(node.lastSuccessfulSyncAt)}</td><td>{node.manifests[0] ? `#${node.manifests[0].sequence} · until ${timestamp(node.manifests[0].validUntil)}` : "None"}</td>
            <td>{node.cachedContentCount}</td><td>{node.pendingProofCount}</td><td>{node.softwareVersion || "Not reported"}</td></tr>)}</tbody></table></div>}
      <p className={styles.note}>Offline means no recent heartbeat. It does not prove the local Edge has stopped; signed offline authorisation is limited by each manifest’s expiry.</p>
    </section></main>;
}
