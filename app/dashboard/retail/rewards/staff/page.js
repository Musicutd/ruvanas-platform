import { notFound } from "next/navigation";
import { readStaffAdminPolicy } from "@/lib/retail-rewards/staff-admin-contracts.mjs";
import RewardsStaffAdmin from "./RewardsStaffAdmin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rewards staff access | Ruvanas", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function RewardsStaffPage() {
  if (!readStaffAdminPolicy(process.env).enabled) notFound();
  const { loadRewardStaffAdminPage } = await import("@/lib/retail-rewards/staff-admin-server");
  const result = await loadRewardStaffAdminPage();
  return <RewardsStaffAdmin initialData={JSON.parse(JSON.stringify(result))} />;
}
