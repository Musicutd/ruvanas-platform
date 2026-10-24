import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/requireAdmin";
import { loadRetailStreamSetup } from "@/lib/retail-stream-setup-service.mjs";
import { safeRetailStreamSetupView } from "@/lib/retail-stream-setup-ui.mjs";
import RetailStreamConnectionForm from "./RetailStreamConnectionForm";
import styles from "./retail-stream.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Retail connection draft | Ruvanas administration" };

export default async function RetailStreamSetupPage({ params }) {
  const actor = await getAdminUser();
  if (!actor) redirect("/login");
  if (actor.role !== "SUPER_ADMIN") redirect("/admin/organisations");
  const { organisationId } = await params;
  if (typeof organisationId !== "string" || !/^[A-Za-z0-9_-]{1,191}$/.test(organisationId)) notFound();
  let setup = null;
  try {
    setup = safeRetailStreamSetupView(await loadRetailStreamSetup(prisma, { actorUserId: actor.id, organisationId }), organisationId);
  } catch {
    // Auth/service errors are intentionally not serialized into a client form.
  }
  return <main className={styles.page}>
    <Link href="/admin/organisations" className={styles.back}>← Existing organisations</Link>
    <header className={styles.header}><p className={styles.eyebrow}>SUPER ADMIN · RETAIL DRAFT SETUP</p>
      <h1>{setup ? `${setup.organisation.name} · shared Retail stream` : "Retail connection needs review"}</h1>
      <p>Save this subscriber’s provider details once for one shared programme across its shops. This screen prepares a private draft only; it does not connect a provider, copy the music catalogue or allocate infrastructure.</p>
    </header>
    {setup ? <RetailStreamConnectionForm key={setup.organisation.id} initialSetup={setup} /> : <section className={styles.error} role="alert">
      <h2>Setup is unavailable</h2><p>The existing organisation, Retail permission or draft state could not be verified. Reload or review the organisation before continuing. No account, plan or streaming connection has been changed.</p>
    </section>}
  </main>;
}
