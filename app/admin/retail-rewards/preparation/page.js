import { loadPilotPreparationPage } from "@/lib/retail-rewards/pilot-preparation-server";
import { safePilotPreparationSnapshot } from "@/lib/retail-rewards/pilot-preparation-contracts.mjs";
import PilotPreparation from "./PilotPreparation";
import styles from "../pilot/pilot-admin.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rewards pilot preparation | Ruvanas", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function PilotPreparationPage({ searchParams }) {
  const query = await searchParams;
  const organisationId = query?.organisationId;
  if (typeof organisationId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,190}$/.test(organisationId)) {
    return <div className={styles.page}><section className={styles.container}>
      <p className={styles.eyebrow}>RUVANAS REWARDS · SUPER ADMIN</p>
      <h1>Pilot preparation</h1>
      <p>Choose the prepared test workspace from Organisations to review its saved setup.</p>
      <p>This is a read-only check. It does not enable Rewards or grant pilot access.</p>
      <a href="/admin/organisations">Open Organisations →</a>
    </section></div>;
  }
  const result = await loadPilotPreparationPage(organisationId);
  const snapshot = safePilotPreparationSnapshot(result, organisationId);
  if (!snapshot) return <div className={styles.page}><section className={styles.container} role="alert">
    <h1>Pilot preparation unavailable</h1>
    <p>{result?.code === "AUTH_REQUIRED" ? "Sign in with your Ruvanas Super Admin account to review this test workspace." : "A verified preparation snapshot is not available for this session and test workspace."}</p>
    <p>No setup or access settings were changed.</p>
    <a href="/admin/organisations">Back to Organisations →</a>
  </section></div>;
  return <PilotPreparation key={organisationId} organisationId={organisationId} initialSnapshot={snapshot} />;
}
