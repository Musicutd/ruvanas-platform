import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { validateEnterprisePolicy } from "@/lib/enterprise-security.mjs";
import { getRequestId } from "@/lib/security-log";

const providerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  protocol: z.enum(["OIDC", "SAML"]),
  issuer: z.string().trim().url().max(500),
  clientId: z.string().trim().max(300).nullable().optional(),
  metadataUrl: z.string().trim().url().max(500).nullable().optional(),
  emailDomain: z.string().trim().max(255).nullable().optional()
});

const updateSchema = z.object({
  sessionMaxAgeMinutes: z.number().int(),
  idleTimeoutMinutes: z.number().int(),
  allowedEmailDomains: z.array(z.string()).max(50),
  passwordFallback: z.boolean(),
  ssoRequired: z.boolean(),
  identityProvider: providerSchema.nullable().optional()
});

async function superAdminAccess() {
  const access = await requirePlatformAdmin();
  if (!access.ok) return access;
  if (access.user.role !== "SUPER_ADMIN") {
    return { ok: false, status: 403, error: "Only a Ruvanas Super Admin can manage enterprise security." };
  }
  return access;
}

export async function GET(_request, { params }) {
  const access = await superAdminAccess();
  if (!access.ok) return accessDenied(access);

  const organisation = await prisma.organisation.findUnique({
    where: { id: String(params.organisationId || "") },
    include: {
      enterpriseSecurityPolicy: true,
      enterpriseIdentityProviders: { orderBy: { createdAt: "desc" } },
      serviceAccounts: {
        include: { apiKeys: { select: { id: true, name: true, prefix: true, status: true, expiresAt: true, lastUsedAt: true, createdAt: true } } },
        orderBy: { createdAt: "desc" }
      }
    }
  });

  if (!organisation) return NextResponse.json({ error: "Organisation not found." }, { status: 404 });
  return NextResponse.json({ organisation });
}

export async function PATCH(request, { params }) {
  try {
    const access = await superAdminAccess();
    if (!access.ok) return accessDenied(access);

    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid security policy." }, { status: 400 });
    }

    const organisationId = String(params.organisationId || "");
    const organisation = await prisma.organisation.findUnique({ where: { id: organisationId } });
    if (!organisation) return NextResponse.json({ error: "Organisation not found." }, { status: 404 });

    const validation = validateEnterprisePolicy(parsed.data, { providerReady: false });
    if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 409 });

    const result = await prisma.$transaction(async (tx) => {
      const policy = await tx.enterpriseSecurityPolicy.upsert({
        where: { organisationId },
        create: { organisationId, ...validation.policy },
        update: validation.policy
      });

      let identityProvider = null;
      if (parsed.data.identityProvider) {
        const provider = parsed.data.identityProvider;
        identityProvider = await tx.enterpriseIdentityProvider.upsert({
          where: { organisationId_issuer: { organisationId, issuer: provider.issuer } },
          create: {
            organisationId,
            name: provider.name,
            protocol: provider.protocol,
            issuer: provider.issuer,
            clientId: provider.clientId || null,
            metadataUrl: provider.metadataUrl || null,
            emailDomain: provider.emailDomain || null,
            status: "DRAFT"
          },
          update: {
            name: provider.name,
            protocol: provider.protocol,
            clientId: provider.clientId || null,
            metadataUrl: provider.metadataUrl || null,
            emailDomain: provider.emailDomain || null,
            status: "DRAFT"
          }
        });
      }

      await tx.auditLog.create({
        data: {
          organisationId,
          actorUserId: access.user.id,
          action: "ENTERPRISE_SECURITY_POLICY_UPDATED",
          entityType: "EnterpriseSecurityPolicy",
          entityId: policy.id,
          details: {
            ssoRequired: policy.ssoRequired,
            passwordFallback: policy.passwordFallback,
            sessionMaxAgeMinutes: policy.sessionMaxAgeMinutes,
            idleTimeoutMinutes: policy.idleTimeoutMinutes,
            allowedEmailDomains: policy.allowedEmailDomains,
            identityProviderId: identityProvider?.id || null,
            identityProviderStatus: identityProvider?.status || null,
            requestId: getRequestId(request)
          }
        }
      });

      return { policy, identityProvider };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Enterprise security update error:", error);
    return NextResponse.json({ error: "Unable to update enterprise security." }, { status: 500 });
  }
}
