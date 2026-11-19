import { NextResponse } from "next/server";
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";
import { getActiveOrganisationContext } from "@/lib/auth";
import { getR2Storage } from "@/lib/r2";
import { RETAIL_SUBSCRIBER_ORGANISATION_INCLUDE } from "@/lib/retail-subscriber-access.mjs";
import { PREVIEW_RESPONSE_HEADERS as headers } from "@/lib/private-preview-request.mjs";
import { assertRetailCommercialUploadAccess, retailCommercialUploads, uploadRetailCommercial } from "@/lib/retail-commercial-upload-service.mjs";
import { retailCommercialUploadRequestBoundary, readRetailCommercialUpload, withRetailCommercialUploadAdmission,
  retailCommercialUploadError } from "@/lib/retail-commercial-upload-request.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const failure = error => { const { status, ...body } = retailCommercialUploadError(error); return NextResponse.json(body, { status, headers }); };
export async function GET(request) {
  try {
    retailCommercialUploadRequestBoundary(request);
    const context = await getActiveOrganisationContext(RETAIL_SUBSCRIBER_ORGANISATION_INCLUDE);
    return NextResponse.json(await retailCommercialUploads(prisma, { context }), { status: 200, headers });
  } catch (error) { return failure(error); }
}
export async function POST(request) {
  try {
    retailCommercialUploadRequestBoundary(request, { write: true });
    const context = await getActiveOrganisationContext(RETAIL_SUBSCRIBER_ORGANISATION_INCLUDE);
    await assertRetailCommercialUploadAccess(prisma, { context });
    return await withRetailCommercialUploadAdmission(async () => {
      const input = await readRetailCommercialUpload(request);
      const storage = {
        async put(key, buffer, contentType, checksum) {
          const r2 = getR2Storage();
          await r2.client.send(new PutObjectCommand({ Bucket: r2.bucketName, Key: key, Body: buffer,
            ContentType: contentType, Metadata: { checksum }, CacheControl: "private, no-store" }), { abortSignal: AbortSignal.timeout(30_000) });
        },
        async remove(key) {
          const r2 = getR2Storage();
          await r2.client.send(new DeleteObjectCommand({ Bucket: r2.bucketName, Key: key }), { abortSignal: AbortSignal.timeout(15_000) });
        }
      };
      return NextResponse.json(await uploadRetailCommercial(prisma, { context, input, storage }), { status: 200, headers });
    });
  } catch (error) { return failure(error); }
}
