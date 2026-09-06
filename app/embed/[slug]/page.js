import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import PublicRadioPlayer from "@/app/components/PublicRadioPlayer";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function PublicEmbedPage({ params }) {
  const station = await prisma.station.findFirst({ where: { slug: params.slug, status: "ACTIVE", publicPlayerEnabled: true }, select: { id: true } });
  if (!station) notFound();
  return <main style={{ minHeight: "100vh", background: "#0c1525" }}><PublicRadioPlayer slug={params.slug} compact /></main>;
}
