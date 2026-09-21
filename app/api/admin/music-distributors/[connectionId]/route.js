import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { encryptDistributorCredentials, safeDistributorConnection, testMusicDistributorConnection } from "@/lib/music-distributor-service";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("TEST") }).strict(),
  z.object({ action: z.literal("ACTIVATE") }).strict(),
  z.object({ action: z.literal("PAUSE") }).strict(),
  z.object({ action: z.literal("REVOKE") }).strict(),
  z.object({ action: z.literal("ROTATE_CREDENTIALS"), clientId: z.string().trim().min(1).max(500), clientSecret: z.string().min(12).max(4000) }).strict()
]);

export async function PATCH(request, { params }) {
  const access = await requirePlatformAdmin();
  if (!access.ok) return accessDenied(access);
  if (access.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Only a Ruvanas Super Admin can control music distributors." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Choose a valid distributor action." }, { status: 400 });
  const connection = await prisma.musicDistributorConnection.findUnique({ where: { id: params.connectionId } });
  if (!connection) return NextResponse.json({ error: "Music distributor not found." }, { status: 404 });
  if (connection.providerKey === "PROMO_ONLY") return NextResponse.json({ error: "Manage Promo Only through its separate testing controls and server-side feature gates." }, { status: 409 });
  if (connection.status === "REVOKED" && parsed.data.action !== "TEST") return NextResponse.json({ error: "A revoked distributor connection cannot be changed." }, { status: 409 });
  try {
    if (parsed.data.action === "TEST") {
      const result = await testMusicDistributorConnection(connection);
      const authenticatedAt = new Date();
      await prisma.$transaction([
        prisma.musicDistributorConnection.update({ where: { id: connection.id }, data: { lastAuthenticatedAt: authenticatedAt, lastErrorAt: null, lastErrorCode: null } }),
        prisma.auditLog.create({ data: { actorUserId: access.user.id, action: "MUSIC_DISTRIBUTOR_AUTH_TESTED", entityType: "MusicDistributorConnection", entityId: connection.id, details: { providerKey: connection.providerKey, authenticated: true } } })
      ]);
      return NextResponse.json({ result, notice: "OAuth client-credentials authentication succeeded." });
    }
    const now = new Date();
    if (parsed.data.action === "ACTIVATE" && (!connection.lastAuthenticatedAt || now.getTime() - connection.lastAuthenticatedAt.getTime() > 24 * 60 * 60 * 1000)) {
      return NextResponse.json({ error: "Test OAuth authentication successfully before activation. The test must be less than 24 hours old." }, { status: 409 });
    }
    const data = parsed.data.action === "ACTIVATE"
      ? { status: "ACTIVE", nextSyncAt: now, pausedAt: null, revokedAt: null }
      : parsed.data.action === "PAUSE"
        ? { status: "PAUSED", pausedAt: now, nextSyncAt: null, syncLeaseOwner: null, syncLeaseUntil: null }
        : parsed.data.action === "REVOKE"
          ? { status: "REVOKED", revokedAt: now, nextSyncAt: null, syncLeaseOwner: null, syncLeaseUntil: null }
          : { clientCredentialsEncrypted: encryptDistributorCredentials(parsed.data), status: "DRAFT", nextSyncAt: null, lastAuthenticatedAt: null };
    const updated = await prisma.$transaction(async (tx) => {
      const item = await tx.musicDistributorConnection.update({ where: { id: connection.id }, data });
      await tx.auditLog.create({ data: { actorUserId: access.user.id, action: `MUSIC_DISTRIBUTOR_${parsed.data.action}`, entityType: "MusicDistributorConnection", entityId: connection.id, details: { providerKey: connection.providerKey } } });
      return item;
    });
    return NextResponse.json({ connection: safeDistributorConnection(updated) });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "The distributor action could not be completed." }, { status: 502 });
  }
}
