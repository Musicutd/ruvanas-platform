import { redirect } from "next/navigation";
import { getPartnerDemoAccess } from "@/lib/partner-demo-session";
import { ruvanasProductGuides } from "@/lib/how-ruvanas-works.mjs";
import PartnerDemoTour from "./PartnerDemoTour";

export const dynamic = "force-dynamic";
export const metadata = { title: "Read-only partner tour | Ruvanas" };

export default async function PartnerDemoPage() {
  const access = await getPartnerDemoAccess();
  if (!access) redirect("/partner-demo/access");

  const products = ruvanasProductGuides.map(({ id, tabLabel, tabDescription, title, introduction, outcome, chapters }) => ({
    id, tabLabel, tabDescription, title, introduction, outcome,
    chapters: chapters.map(({ title: chapterTitle, summary, detail, steps }) => ({ title: chapterTitle, summary, detail, steps }))
  }));
  return <PartnerDemoTour partnerName={access.partnerName} adminPreview={access.type === "SUPER_ADMIN"} products={products} />;
}
