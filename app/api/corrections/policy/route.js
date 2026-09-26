import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { correctionsCanCreateFacility, correctionsRequestContext } from "@/lib/corrections-access";
import { normalizeCorrectionsPolicy } from "@/lib/corrections-policy.mjs";

export const dynamic = "force-dynamic";
const reply = (result) => NextResponse.json(result, { status: result.status || 200 });

export async function GET() {
  const access = await correctionsRequestContext();
  if (!access.ok) return reply(access);
  const policy = await prisma.correctionsProfile.findUnique({ where: { organisationId: access.organisationId } });
  return reply({ ok: true, policy, canEdit: correctionsCanCreateFacility(access) });
}

export async function PATCH(request) {
  const access = await correctionsRequestContext();
  if (!access.ok) return reply(access);
  if (!correctionsCanCreateFacility(access)) return reply({ status: 403, error: "Only the organisation owner can set the organisation-wide policy." });
  let input;
  try { input = normalizeCorrectionsPolicy(await request.json()); }
  catch (error) { return reply({ status: 400, error: error.message }); }
  try {
    const policy = await prisma.$transaction(async (tx) => {
      const saved = await tx.correctionsProfile.upsert({
        where: { organisationId: access.organisationId },
        create: { organisationId: access.organisationId, cleanOnly: true, ...input, policyConfiguredAt: new Date() },
        update: { cleanOnly: true, ...input, policyVersion: { increment: 1 }, policyConfiguredAt: new Date() }
      });
      await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id, action: "CORRECTIONS_ORGANISATION_POLICY_SAVED", entityType: "CorrectionsProfile", entityId: access.organisationId, details: { policyVersion: saved.policyVersion, allowedGenres: input.allowedGenres, restrictedGenres: input.restrictedGenres, blockedTrackCount: input.blockedTrackIds.length, blockedArtistCount: input.blockedArtists.length } } });
      return saved;
    });
    return reply({ ok: true, policy });
  } catch (error) {
    console.error("Corrections policy save failed:", error);
    return reply({ status: 500, error: "The Corrections policy could not be saved." });
  }
}
