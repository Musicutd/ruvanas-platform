import { requireSubscriberProduct } from "@/lib/subscriber-product-access";
import CorrectionsRehabilitation from "./CorrectionsRehabilitation";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inside rehabilitation" };
export default async function CorrectionsRehabilitationPage() {
  await requireSubscriberProduct("CORRECTIONS");
  return <CorrectionsRehabilitation />;
}
