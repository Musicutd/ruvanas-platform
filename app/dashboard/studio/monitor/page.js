import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import BroadcastConsoleClient from "../BroadcastConsoleClient";
import styles from "../studio-pro.module.css";

export const dynamic = "force-dynamic";

export default async function StudioMonitorPage() {
  const context = await getActiveOrganisationContext({ subscription: { include: { plan: true, billingContract: true } } });
  if (!context) redirect("/login");
  if (!context.membership) redirect("/dashboard");
  const entitlements = resolveEntitlements(context.membership.organisation.subscription);
  if (!entitlements.serviceEnabled) redirect("/dashboard");
  return <main className={styles.page}><a href="/dashboard/studio?workspace=console" className={styles.back}>← Broadcast Console</a><BroadcastConsoleClient enabled={entitlements.studioProEnabled} monitor /></main>;
}
