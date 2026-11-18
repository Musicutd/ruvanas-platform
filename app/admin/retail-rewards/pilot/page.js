import { notFound } from "next/navigation";
import { readPilotAdminPolicy } from "@/lib/retail-rewards/pilot-admin-contracts.mjs";
import { loadPilotAdminPage } from "@/lib/retail-rewards/pilot-admin-server";
import RewardsPilotAdmin from "./RewardsPilotAdmin";
export const dynamic = "force-dynamic";
export const metadata = { title: "Rewards pilot setup | Ruvanas", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function PilotAdminPage() {
  if (!readPilotAdminPolicy(process.env).enabled) notFound();
  const result = await loadPilotAdminPage();
  if (!result.ok) return <section role="alert"><h1>Rewards pilot setup unavailable</h1><p>{result.error}</p></section>;
  return <RewardsPilotAdmin initialOrganisations={result.organisations} />;
}
