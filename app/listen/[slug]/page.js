import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import PublicRadioPlayer from "@/app/components/PublicRadioPlayer";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const station = await prisma.station.findFirst({ where: { slug: params.slug, status: "ACTIVE", publicPlayerEnabled: true }, select: { name: true, description: true, publicPlayerTagline: true } });
  return station ? { title: `Listen live — ${station.name} | Ruvanas`, description: station.publicPlayerTagline || station.description || `Listen live to ${station.name} on Ruvanas.` } : { title: "Station unavailable | Ruvanas" };
}

export default async function PublicListenPage({ params }) {
  const station = await prisma.station.findFirst({ where: { slug: params.slug, status: "ACTIVE", publicPlayerEnabled: true }, select: { id: true } });
  if (!station) notFound();
  return <main style={styles.page}><PublicRadioPlayer slug={params.slug} /></main>;
}

const styles = { page: { minHeight: "100vh", display: "grid", placeItems: "center", padding: "32px 18px", boxSizing: "border-box", background: "radial-gradient(circle at 20% 10%, #1d3151, #09111e 48%, #050a12)", color: "#fff" } };
