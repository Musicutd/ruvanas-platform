import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { GENERAL_STATION_MANAGEMENT_WHERE } from "@/lib/general-station-boundary.mjs";
import PublicRadioPlayer from "@/app/components/PublicRadioPlayer";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function PublicEmbedPage({ params }) {
  const { slug } = await params;
  const station = await prisma.station.findFirst({ where: { slug, status: "ACTIVE", publicPlayerEnabled: true, ...GENERAL_STATION_MANAGEMENT_WHERE }, select: { id: true } });
  if (!station) notFound();
  return <main style={{ minHeight: "100vh", background: "#0c1525" }}><PublicRadioPlayer slug={slug} compact /></main>;
}
