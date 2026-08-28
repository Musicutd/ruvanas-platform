import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { generateServiceApiKey, SERVICE_ACCOUNT_SCOPES } from "@/lib/enterprise-security.mjs";
import { getRequestId } from "@/lib/security-log";

const schema = z.object({
  organisationId: z.string().min(1),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).nullable().optional(),
  scopes: z.array(z.enum(SERVICE_ACCOUNT_SCOPES)).min(1),
  expiresAt: z.string().datetime().nullable().optional()
});

export async function POST(request) {
  try {
    const access = await requirePlatformAdmin();
    if (!access.ok) return accessDenied(access);
    if (access.user.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Only a Ruvanas Super Admin can create service accounts." }, { status: 403 });
    }

    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid service account." }, { status: 400 });

    const organisation = await prisma.organisation.findUnique({ where: { id: parsed.data.organisationId } });
    if (!organisation) return NextResponse.json({ error: "Organisation not found." }, { status: 404 });

    const keyMaterial = generateServiceApiKey(process.env.SESSION_SECRET);
    const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;
    if (expiresAt && expiresAt <= new Date()) return NextResponse.json({ error: "Expiry must be in the future." }, { status: 400 });

    const result = await prisma.$transaction(async (tx) => {
      const serviceAccount = await tx.serviceAccount.create({
        data: {
          organisationId: organisation.id,
          createdByUserId: access.user.id,
          name: parsed.data.name,
          description: parsed.data.description || null,
          scopes: [...new Set(parsed.data.scopes)].sort(),
          expiresAt,
          apiKeys: { create: { name: "Initial key", prefix: keyMaterial.prefix, tokenHash: keyMaterial.tokenHash, expiresAt } }
        },
        include: { apiKeys: { select: { id: true, name: true, prefix: true, status: true, expiresAt: true, createdAt: true } } }
      });
      await tx.auditLog.create({
        data: {
          organisationId: organisation.id,
          actorUserId: access.user.id,
          action: "SERVICE_ACCOUNT_CREATED",
          entityType: "ServiceAccount",
          entityId: serviceAccount.id,
          details: { name: serviceAccount.name, scopes: serviceAccount.scopes, keyPrefix: keyMaterial.prefix, expiresAt, requestId: getRequestId(request) }
        }
      });
      return serviceAccount;
    });

    return NextResponse.json({
      ok: true,
      serviceAccount: result,
      apiKey: keyMaterial.rawKey,
      notice: "Copy this API key now. Ruvanas stores only its hash and cannot show it again."
    }, { status: 201 });
  } catch (error) {
    if (error?.code === "P2002") return NextResponse.json({ error: "A service account with this name already exists for the organisation." }, { status: 409 });
    console.error("Create service account error:", error);
    return NextResponse.json({ error: "Unable to create the service account." }, { status: 500 });
  }
}
