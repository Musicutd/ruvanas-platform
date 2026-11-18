import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import PublicRadioPlayer from "@/app/components/PublicRadioPlayer";
import PwaLifecycle from "@/app/components/PwaLifecycle";
import { isManagedRetailStreamDraftStation } from "@/lib/retail-stream-draft-boundary.mjs";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const station = await prisma.station.findFirst({ where: { slug, status: "ACTIVE", publicPlayerEnabled: true }, select: { id: true, organisationId: true, productFamily: true, slug: true, name: true, description: true, publicPlayerTagline: true, stationWebsiteEnabled: true } });
  return station && !isManagedRetailStreamDraftStation(station) ? {
    title: `Listen live — ${station.name} | Ruvanas`,
    description: station.publicPlayerTagline || station.description || `Listen live to ${station.name} on Ruvanas.`,
    ...(station.stationWebsiteEnabled ? { manifest: `/api/public/station-websites/${slug}/manifest`, appleWebApp: { capable: true, title: station.name, statusBarStyle: "black-translucent" } } : {})
  } : { title: "Station unavailable | Ruvanas" };
}

export default async function PublicListenPage({ params }) {
  const { slug } = await params;
  const station = await prisma.station.findFirst({ where: { slug, status: "ACTIVE", publicPlayerEnabled: true }, select: { id: true, organisationId: true, productFamily: true, slug: true, stationWebsiteEnabled: true } });
  if (!station || isManagedRetailStreamDraftStation(station)) notFound();
  return <main style={styles.page}><PublicRadioPlayer slug={slug} />{station.stationWebsiteEnabled ? <PwaLifecycle stationPath={`/radio/${slug}`} /> : null}</main>;
}

const styles = { page: { minHeight: "100vh", display: "grid", placeItems: "center", padding: "32px 18px", boxSizing: "border-box", background: "radial-gradient(circle at 20% 10%, #1d3151, #09111e 48%, #050a12)", color: "#fff" } };
