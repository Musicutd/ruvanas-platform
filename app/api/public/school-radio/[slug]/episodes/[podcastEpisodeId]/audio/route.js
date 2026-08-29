import { GetObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { getR2Storage } from "@/lib/r2";
import { loadPublicSchoolPodcastAudio } from "@/lib/public-school-podcast";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseRange(value, total) {
  if (!value?.startsWith("bytes=")) return null;
  const [startValue, endValue] = value.slice(6).split("-", 2);
  const start = Number.parseInt(startValue, 10);
  const end = endValue ? Number.parseInt(endValue, 10) : total - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= total) return "invalid";
  return { start, end: Math.min(end, total - 1) };
}

export async function GET(request, { params }) {
  try {
    const { slug, podcastEpisodeId } = await params;
    const asset = await loadPublicSchoolPodcastAudio(String(slug || "").toLowerCase(), String(podcastEpisodeId || ""));
    if (!asset) return NextResponse.json({ error: "This school podcast audio is not publicly available." }, { status: 404 });
    const total = Number(asset.sizeBytes);
    if (!Number.isFinite(total) || total <= 0) return NextResponse.json({ error: "The published audio has an invalid size." }, { status: 500 });
    const range = parseRange(request.headers.get("range"), total);
    if (range === "invalid") return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${total}` } });
    const r2 = getR2Storage();
    const object = await r2.client.send(new GetObjectCommand({ Bucket: r2.bucketName, Key: asset.storageKey, ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}) }));
    const body = typeof object.Body?.transformToWebStream === "function" ? object.Body.transformToWebStream() : object.Body;
    if (!body) return NextResponse.json({ error: "The published audio could not be loaded." }, { status: 502 });
    const length = range ? range.end - range.start + 1 : total;
    const headers = new Headers({ "Accept-Ranges": "bytes", "Content-Type": object.ContentType || asset.mimeType || "audio/mpeg", "Content-Length": String(length), "Cache-Control": "public, max-age=300", "Content-Disposition": "inline" });
    if (range) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${total}`);
    return new NextResponse(body, { status: range ? 206 : 200, headers });
  } catch (error) {
    console.error("Public school podcast stream failed:", error);
    return NextResponse.json({ error: "The published audio could not be played." }, { status: 500 });
  }
}
