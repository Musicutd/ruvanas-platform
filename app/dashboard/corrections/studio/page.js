import { requireSubscriberProduct } from "@/lib/subscriber-product-access";
import CorrectionsStudioSessions from "./CorrectionsStudioSessions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inside supervised Studio" };

export default async function CorrectionsStudioPage() {
  await requireSubscriberProduct("CORRECTIONS");
  return <CorrectionsStudioSessions />;
}
