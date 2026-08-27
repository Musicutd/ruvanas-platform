import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import PromoUploadForm from "./PromoUploadForm";

export default async function PromoUploadPage({ searchParams }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "SUPER_ADMIN") redirect("/admin/media");

  const query = await searchParams;
  const initialPromoAssetId = String(query?.promoAssetId || "");

  const organisations = await prisma.organisation.findMany({
    select: {
      id: true,
      name: true,
      promoAssets: {
        where: { status: "ACTIVE" },
        select: { id: true, name: true, mediaType: true, languageCode: true },
        orderBy: { name: "asc" }
      }
    },
    orderBy: { name: "asc" }
  });

  return (
    <PromoUploadForm
      organisations={organisations}
      initialPromoAssetId={initialPromoAssetId}
    />
  );
}

