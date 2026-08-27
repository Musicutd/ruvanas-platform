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
        mediaAsset: {
          organisationId: null,
          libraryType: "RUVANAS_CATALOGUE",
          mediaType: "MUSIC",
          status: "READY"
        }
      },
      select: { id: true, title: true, artist: true, isExplicit: true },
      orderBy: [{ artist: "asc" }, { title: "asc" }]
    })
  ]);

  return <NewMusicModeForm organisations={organisations} tracks={tracks} />;
}

