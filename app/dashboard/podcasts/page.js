import { requireSubscriberProduct } from "@/lib/subscriber-product-access";
import PodcastWorkspace from "./PodcastWorkspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Podcasts | Ruvanas" };

export default async function PodcastsPage({ searchParams }) {
  const query = await searchParams;
  const candidate = String(query?.product || "ONLINE").toUpperCase();
  const product = ["ONLINE", "HEALTH", "FAITH"].includes(candidate) ? candidate : "ONLINE";
  await requireSubscriberProduct(product);
  return <PodcastWorkspace product={product} initialMediaAssetId={String(query?.mediaAssetId || "")} />;
}
