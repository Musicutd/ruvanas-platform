import { notFound } from "next/navigation";
import { readReportsPolicy } from "@/lib/retail-rewards/reports-contracts.mjs";
import ReportsClient from "./ReportsClient";
export const dynamic = "force-dynamic";
export const metadata = { title: "Shop coupon reports · Ruvanas Rewards", robots: { index: false, follow: false } };
export default async function RewardsReportsPage() {
  if (!readReportsPolicy(process.env).enabled) notFound();
  const { loadRewardReportsPage } = await import("@/lib/retail-rewards/reporting-server");
  const result = await loadRewardReportsPage();
  return <ReportsClient initialData={JSON.parse(JSON.stringify(result))} />;
}
