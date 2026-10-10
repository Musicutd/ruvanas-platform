import { authenticateCorrectionsEdge } from "@/lib/corrections-edge-service";
import { authorisedCorrectionsEdgeMedia } from "@/lib/corrections-edge-sync-service";
import { correctionsError } from "@/lib/corrections-http";
import { protectedAudioResponse } from "@/lib/protected-audio-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request, { params }) {
  try { const node = await authenticateCorrectionsEdge(request);
    const { mediaAssetId } = await params;
    const asset = await authorisedCorrectionsEdgeMedia(node, String(mediaAssetId || ""));
    return protectedAudioResponse(request, asset); }
  catch (error) { return correctionsError(error); }
}
