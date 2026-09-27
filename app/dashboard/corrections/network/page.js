import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { correctionsRequestContext } from "@/lib/corrections-access";
import { correctionsNetworkAuthority } from "@/lib/corrections-network-service";
import NetworkDashboard from "./NetworkDashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inside Network | Ruvanas" };

export default async function CorrectionsNetworkPage() {
  const access = await correctionsRequestContext();
  if (!access.ok) notFound();
  try { await correctionsNetworkAuthority(prisma, access, "view"); }
  catch { notFound(); }
  return <NetworkDashboard />;
}
