import { requireSubscriberProduct } from "@/lib/subscriber-product-access";
import CorrectionsAnnouncements from "./CorrectionsAnnouncements";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inside announcements" };

export default async function CorrectionsAnnouncementsPage() {
  await requireSubscriberProduct("CORRECTIONS");
  return <CorrectionsAnnouncements />;
}
