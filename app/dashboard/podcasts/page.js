import { requireSubscriberProduct } from "@/lib/subscriber-product-access";
import PodcastWorkspace from "./PodcastWorkspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Podcasts | Ruvanas" };

export default async function PodcastsPage() {
  await requireSubscriberProduct("ONLINE");
  return <PodcastWorkspace />;
}
