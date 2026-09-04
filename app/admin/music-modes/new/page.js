import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import NewMusicModeForm from "./NewMusicModeForm";

export default async function NewMusicModePage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");
  if (user.role !== "SUPER_ADMIN") redirect("/admin/channels");

  const [organisations, tracks] = await Promise.all([
    prisma.organisation.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" }
    }),
    prisma.track.findMany({
      where: {
        status: "READY",
        OR: [
          { mediaAsset: { organisationId: null, libraryType: "RUVANAS_CATALOGUE", mediaType: "MUSIC", status: "READY" } },
          {
            rightsReviewStatus: "APPROVED",
            permittedUses: { hasEvery: ["RETAIL_RADIO", "SCHOOL_RADIO", "ONLINE_RADIO"] },
            mediaAsset: { organisationId: { not: null }, libraryType: "ORGANISATION_MUSIC", mediaType: "MUSIC", status: "READY" }
          }
        ]
      },
      select: {
        id: true,
        title: true,
        artist: true,
        isExplicit: true,
        mediaAsset: { select: { organisationId: true, libraryType: true } }
      },
      orderBy: [{ artist: "asc" }, { title: "asc" }]
    })
  ]);

  return <NewMusicModeForm organisations={organisations} tracks={tracks} />;
}

