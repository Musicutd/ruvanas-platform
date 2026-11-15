import { notFound } from "next/navigation";
import { readReversalPolicy } from "@/lib/retail-rewards/reversal-contracts.mjs";
import CorrectionClient from "./CorrectionClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Correct a redemption · Ruvanas Rewards", robots: { index: false, follow: false } };

export default async function RewardsCorrectionsPage() {
  if (!readReversalPolicy(process.env).enabled) notFound();
  const { loadRewardCorrectionsPage } = await import("@/lib/retail-rewards/reversal-server");
  const result = await loadRewardCorrectionsPage();
  return <CorrectionClient initialData={JSON.parse(JSON.stringify(result))} />;
}
