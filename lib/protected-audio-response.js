import { GetObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { getR2Storage } from "./r2";

function parseRange(header, length) {
  if (!header || !header.startsWith("bytes=")) return null;
  const [startValue, endValue] = header.slice(6).split("-", 2);
  const start = Number.parseInt(startValue, 10);
  const end = endValue ? Number.parseInt(endValue, 10) : length - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || end < start || start >= length) return "invalid";
  return { start, end: Math.min(end, length - 1) };
}

function streamBody(body) {
  if (!body) return null;
  return typeof body.transformToWebStream === "function" ? body.transformToWebStream() : body;
}

export async function protectedAudioResponse(request, asset) {
  if (!asset) return NextResponse.json({ error: "The audio file was not found." }, { status: 404 });
  const totalLength = Number(asset.sizeBytes);
  if (!Number.isFinite(totalLength) || totalLength <= 0) return NextResponse.json({ error: "The audio file has an invalid size." }, { status: 500 });
  const range = parseRange(request.headers.get("range"), totalLength);
  if (range === "invalid") return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${totalLength}` } });
  const r2 = getR2Storage();
  const object = await r2.client.send(new GetObjectCommand({ Bucket: r2.bucketName, Key: asset.storageKey, ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}) }));
  const body = streamBody(object.Body);
  if (!body) return NextResponse.json({ error: "The audio storage response was empty." }, { status: 502 });
  const contentLength = range ? range.end - range.start + 1 : totalLength;
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Content-Type": object.ContentType || asset.mimeType || "audio/mpeg",
    "Content-Length": String(contentLength),
    "Cache-Control": "private, no-store",
    "Content-Disposition": "inline",
    "X-Content-Type-Options": "nosniff"
  });
  if (range) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${totalLength}`);
  return new NextResponse(body, { status: range ? 206 : 200, headers });
}
