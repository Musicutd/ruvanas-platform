import { notFound } from "next/navigation";
import { readPilotPreviewPolicy } from "@/lib/retail-rewards/pilot-preview-policy.mjs";
import PilotSignInClient from "./PilotSignInClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Private pilot sign-in · Ruvanas Rewards", robots: { index: false, follow: false } };

export default function RewardsPilotSignInPage() {
  if (!readPilotPreviewPolicy(process.env).enabled) notFound();
  return <PilotSignInClient />;
}
