import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { getRequestId } from "@/lib/security-log";
import { parseDistributorConnection } from "@/lib/music-distributor.mjs";
import { encryptDistributorCredentials, safeDistributorConnection } from "@/lib/music-distributor-service";

export async function POST(request) {
  const access = await requirePlatformAdmin();
  if (!access.ok) return accessDenied(access);
  if (access.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Only a Ruvanas Super Admin can configure music distributors." }, { status: 403 });
  const parsed = parseDistributorConnection(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const { clientId, clientSecret, ...settings } = parsed.data;
    const connection = await prisma.$transaction(async (tx) => {
      const created = await tx.musicDistributorConnection.create({ data: {
        ...settings,
        createdByUserId: access.user.id,
        clientCredentialsEncrypted: encryptDistributorCredentials({ clientId, clientSecret }),
        status: "DRAFT"
      } });
      await tx.auditLog.create({ data: {
        actorUserId: access.user.id,
        action: "MUSIC_DISTRIBUTOR_CREATED",
        entityType: "MusicDistributorConnection",
        entityId: created.id,
        details: { providerKey: created.providerKey, apiOrigin: new URL(created.apiBaseUrl).origin, requestId: getRequestId(request) }
      } });
      return created;
    });
    return NextResponse.json({ connection: safeDistributorConnection(connection), notice: "Draft distributor connection created. Test authentication before activation." }, { status: 201 });
  } catch (error) {
    if (error?.code === "P2002") return NextResponse.json({ error: "That distributor name or provider key is already in use." }, { status: 409 });
    return NextResponse.json({ error: "The distributor connection could not be created safely." }, { status: 500 });
  }
}
