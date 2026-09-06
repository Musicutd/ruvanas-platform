import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  RADIO_ADVERTISING_POLICY_VERSION,
  canManageRadioAdvertising,
  normalizeRadioAdvertisingPolicy,
  radioAdvertisingConfigurationHash,
  transitionRadioAdvertisingPolicy
} from "@/lib/radio-advertising.mjs";
import { getRadioAdvertisingContext, loadRadioAdvertisingWorkspace } from "@/lib/radio-advertising-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const policyFields = {
  stationId: z.string().cuid(),
  channelId: z.string().cuid(),
  pacingMode: z.enum(["EVEN", "PRIORITY"]),
  maxSpotsPerBreak: z.coerce.number().int(),
  maxBreakSeconds: z.coerce.number().int(),
  minBreakGapMinutes: z.coerce.number().int(),
  maxAdvertisingSecondsPerHour: z.coerce.number().int()
};

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("SAVE_POLICY"), ...policyFields }),
  z.object({ action: z.literal("ACTIVATE_POLICY"), policyId: z.string().cuid() }),
  z.object({ action: z.literal("PAUSE_POLICY"), policyId: z.string().cuid() })
]);

function failure(access) {
  return NextResponse.json({ error: access.error }, { status: access.status });
}

function managerRequired(access) {
  return canManageRadioAdvertising(access.membership.role)
    ? null
    : NextResponse.json({ error: "An organisation owner or manager must control radio advertising policies." }, { status: 403 });
}

async function writeAudit(tx, access, action, policy, details = {}) {
  await tx.auditLog.create({ data: {
    organisationId: access.organisation.id,
    actorUserId: access.user.id,
    action,
    entityType: "RadioAdvertisingPolicy",
    entityId: policy.id,
    details: {
      policyVersion: RADIO_ADVERTISING_POLICY_VERSION,
      stationId: policy.stationId,
      channelId: policy.channelId,
      revision: policy.revision,
      ...details
    }
  } });
}

async function ownedChannel(organisationId, stationId, channelId) {
  return prisma.channel.findFirst({
    where: { id: channelId, stationId, organisationId, status: "ACTIVE", station: { status: "ACTIVE" } },
    select: { id: true, stationId: true }
  });
}

export async function GET() {
  const access = await getRadioAdvertisingContext();
  if (!access.ok) return failure(access);
  return NextResponse.json(await loadRadioAdvertisingWorkspace(access));
}

export async function POST(request) {
  const access = await getRadioAdvertisingContext();
  if (!access.ok) return failure(access);
  const denied = managerRequired(access);
  if (denied) return denied;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the advertising policy details and try again." }, { status: 400 });
  const data = parsed.data;
  const organisationId = access.organisation.id;

  try {
    if (data.action === "SAVE_POLICY") {
      const input = normalizeRadioAdvertisingPolicy(data);
      if (!await ownedChannel(organisationId, input.stationId, input.channelId)) {
        return NextResponse.json({ error: "Choose an active channel owned by the selected station." }, { status: 404 });
      }
      const result = await prisma.$transaction(async (tx) => {
        const policy = await tx.radioAdvertisingPolicy.upsert({
          where: { channelId_organisationId: { channelId: input.channelId, organisationId } },
          create: {
            organisationId,
            ...input,
            status: "DRAFT",
            policyVersion: RADIO_ADVERTISING_POLICY_VERSION,
            createdByUserId: access.user.id
          },
          update: {
            ...input,
            status: "DRAFT",
            configurationHash: null,
            approvedByUserId: null,
            approvedAt: null,
            policyVersion: RADIO_ADVERTISING_POLICY_VERSION
          }
        });
        await writeAudit(tx, access, "RADIO_ADVERTISING_POLICY_SAVED", policy, { status: policy.status });
        return policy;
      });
      return NextResponse.json({ result });
    }

    const current = await prisma.radioAdvertisingPolicy.findFirst({ where: { id: data.policyId, organisationId } });
    if (!current) return NextResponse.json({ error: "The radio advertising policy was not found." }, { status: 404 });
    if (!await ownedChannel(organisationId, current.stationId, current.channelId)) {
      return NextResponse.json({ error: "The station and channel must remain active before changing this policy." }, { status: 409 });
    }

    if (data.action === "ACTIVATE_POLICY") {
      const policyInput = normalizeRadioAdvertisingPolicy(current);
      const nextStatus = transitionRadioAdvertisingPolicy(current.status, "ACTIVATE");
      const nextRevision = current.revision + 1;
      const configurationHash = radioAdvertisingConfigurationHash({ ...policyInput, revision: nextRevision });
      const result = await prisma.$transaction(async (tx) => {
        const policy = await tx.radioAdvertisingPolicy.update({ where: { id: current.id }, data: {
          status: nextStatus,
          revision: nextRevision,
          configurationHash,
          policyVersion: RADIO_ADVERTISING_POLICY_VERSION,
          approvedByUserId: access.user.id,
          approvedAt: new Date()
        } });
        await writeAudit(tx, access, "RADIO_ADVERTISING_POLICY_ACTIVATED", policy, { configurationHash });
        return policy;
      });
      return NextResponse.json({ result });
    }

    const nextStatus = transitionRadioAdvertisingPolicy(current.status, "PAUSE");
    const result = await prisma.$transaction(async (tx) => {
      const policy = await tx.radioAdvertisingPolicy.update({ where: { id: current.id }, data: { status: nextStatus } });
      await writeAudit(tx, access, "RADIO_ADVERTISING_POLICY_PAUSED", policy, { deliveryBlocked: true });
      return policy;
    });
    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The radio advertising action could not be completed." }, { status: 409 });
  }
}
