import Link from "next/link";
import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import SkipLink from "@/app/components/SkipLink";
import PromotionWorkspace from "./PromotionWorkspace";
import styles from "./promotions.module.css";

export const dynamic = "force-dynamic";

export default async function SubscriberPromotionsPage() {
  const context = await getActiveOrganisationContext();
  if (!context) redirect("/login");
  if (!context.membership) redirect("/dashboard");

  return (
    <main className={styles.page}>
      <SkipLink />
      <header className={styles.header}>
        <Link href="/dashboard" className={styles.brand}>RUVANAS</Link>
        <nav aria-label="Promotion navigation">
          <Link href="/dashboard/programming">Radio programming</Link>
          <Link href="/dashboard" className={styles.back}>Back to dashboard</Link>
        </nav>
      </header>
      <section className={styles.shell} id="main-content">
        <div className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>PROMOTIONS PLANNER</p>
            <h1>Put the right message on air</h1>
            <p className={styles.intro}>
              Schedule approved promotional audio for {context.membership.organisation.name},
              preview its expected delivery and keep every change controlled.
            </p>
          </div>
          <aside className={styles.safetyNote}>
            <strong>Approved audio only</strong>
            <span>Ruvanas quality and rights checks stay protected.</span>
          </aside>
        </div>
        <PromotionWorkspace organisationName={context.membership.organisation.name} />
      </section>
    </main>
  );
}
