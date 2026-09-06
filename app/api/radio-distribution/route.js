import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveRecoveryOrigin } from "@/lib/account-recovery.mjs";
import { encryptSecret } from "@/lib/crypto";
import { generateWebhookSecret, queueOutgoingWebhookEventForConnection } from "@/lib/outgoing-webhook-service";
import { prisma } from "@/lib/prisma";
import {
  RADIO_DISTRIBUTION_EVENT,
  RADIO_DISTRIBUTION_POLICY_VERSION,
  canManageRadioDistribution,
  normalizeRadioDistributionInput,
  radioDistributionPayload,
  radioDistributionReadiness,
  redactedRadioDistributionDestination,
  transitionRadioDistributionDestination
} from "@/lib/radio-distribution.mjs";
import { findOwnedRadioDistributionDestination, getRadioDistributionContext, loadRadioDistributionWorkspace, radioDistributionInclude } from "@/lib/radio-distribution-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("CREATE"), stationId: z.string().cuid(), channelId: z.string().cuid().optional().nullable(),
    kind: z.enum(["DIRECTORY", "STREAM_CDN", "APP_PLATFORM", "VOICE_ASSISTANT"]), providerKey: z.string().trim().min(2).max(80),
    listingName: z.string().trim().min(2).max(140), endpointUrl: z.string().url().max(500),
    territoryCodes: z.union([z.string(), z.array(z.string())]), languageCodes: z.union([z.string(), z.array(z.string())]), categories: z.union([z.string(), z.array(z.string())])
  }),
  z.object({ action: z.enum(["ACTIVATE", "PAUSE", "SYNC"]), destinationId: z.string().cuid() }),
  z.object({ action: z.literal("REVOKE"), destinationId: z.string().cuid(), reason: z.string().trim().min(3).max(500) })
]);

function failure(access) { return NextResponse.json({ error: access.error }, { status: access.status }); }
function managerRequired(access) {
  return canManageRadioDistribution(access.membership.role) ? null : NextResponse.json({ error: "An organisation owner or manager must control distribution destinations." }, { status: 403 });
}
async function audit(tx, { access, action, entityId, details = {} }) {
  await tx.auditLog.create({ data: { organisationId: access.organisation.id, actorUserId: access.user.id, action, entityType: "RadioDistributionDestination", entityId, details: { policyVersion: RADIO_DISTRIBUTION_POLICY_VERSION, ...details } } });
}

export async function GET() {
  const access = await getRadioDistributionContext();
  if (!access.ok) return failure(access);
  return NextResponse.json(await loadRadioDistributionWorkspace(access));
}

export async function POST(request) {
  const access = await getRadioDistributionContext();
  if (!access.ok) return failure(access);
  const denied = managerRequired(access);
  if (denied) return denied;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the distribution details and try again." }, { status: 400 });
  const data = parsed.data;
  const organisationId = access.organisation.id;

  try {
    if (data.action === "CREATE") {
      const input = normalizeRadioDistributionInput(data);
      const station = await prisma.station.findFirst({ where: { id: input.stationId, organisationId }, select: { id: true } });
      if (!station) return NextResponse.json({ error: "Choose a station owned by this organisation." }, { status: 404 });
      if (input.channelId) {
        const channel = await prisma.channel.findFirst({ where: { id: input.channelId, stationId: input.stationId, organisationId, status: "ACTIVE" }, select: { id: true } });
        if (!channel) throw new Error("Choose an active channel owned by this station.");
      }
      const secret = generateWebhookSecret();
      const result = await prisma.$transaction(async (tx) => {
        const connection = await tx.integrationConnection.create({ data: {
          organisationId, createdByUserId: access.user.id, name: `Radio distribution · ${input.listingName} · ${input.providerKey}`,
          kind: "OUTGOING_WEBHOOK", providerKey: input.providerKey, status: "DISCONNECTED", endpointUrl: input.endpointUrl,
          encryptedSecret: encryptSecret(secret), subscribedEventTypes: [RADIO_DISTRIBUTION_EVENT],
          configuration: { adapterContract: RADIO_DISTRIBUTION_POLICY_VERSION, destinationKind: input.kind, credentialDisclosure: "ONE_TIME" }
        } });
        const destination = await tx.radioDistributionDestination.create({ data: {
          organisationId, stationId: input.stationId, channelId: input.channelId, connectionId: connection.id, kind: input.kind,
          providerKey: input.providerKey, listingName: input.listingName, territoryCodes: input.territoryCodes, languageCodes: input.languageCodes,
          categories: input.categories, policyVersion: RADIO_DISTRIBUTION_POLICY_VERSION, createdByUserId: access.user.id
        }, include: radioDistributionInclude });
        await audit(tx, { access, action: "RADIO_DISTRIBUTION_CREATED", entityId: destination.id, details: { stationId: input.stationId, kind: input.kind, providerKey: input.providerKey, endpointOrigin: new URL(input.endpointUrl).origin, secretsExposedInAudit: false } });
        return redactedRadioDistributionDestination(destination);
      });
      return NextResponse.json({ result, signingSecret: secret, notice: "Copy this signing secret now. Ruvanas will not show it again." }, { status: 201 });
    }

    const destination = await findOwnedRadioDistributionDestination(data.destinationId, access);
    if (!destination) return NextResponse.json({ error: "The distribution destination was not found for this organisation." }, { status: 404 });
    if (data.action === "ACTIVATE") {
      const readiness = radioDistributionReadiness({ destination, station: destination.station, channel: destination.channel });
      if (!readiness.ready) throw new Error(`Complete destination readiness first: ${readiness.findings.join(", ").toLowerCase().replaceAll("_", " ")}.`);
    }
    const transition = transitionRadioDistributionDestination(destination, data.action);
    const origin = resolveRecoveryOrigin(request.url);
    const result = await prisma.$transaction(async (tx) => {
      if (data.action === "ACTIVATE") await tx.integrationConnection.update({ where: { id: destination.connectionId }, data: { status: "CONNECTED", disconnectedAt: null } });
      const updated = await tx.radioDistributionDestination.update({ where: { id: destination.id }, data: {
        ...transition, activatedByUserId: data.action === "ACTIVATE" ? access.user.id : undefined
      }, include: radioDistributionInclude });
      await queueOutgoingWebhookEventForConnection(tx, {
        organisationId, connectionId: destination.connectionId, eventType: RADIO_DISTRIBUTION_EVENT,
        sourceId: destination.id, version: updated.revision,
        payload: radioDistributionPayload({ destination: updated, station: updated.station, channel: updated.channel, origin, action: data.action })
      });
      await audit(tx, { access, action: `RADIO_DISTRIBUTION_${data.action}`, entityId: destination.id, details: { stationId: destination.stationId, kind: destination.kind, providerKey: destination.providerKey, revision: updated.revision, reason: data.reason || null, externalAcceptanceClaimed: false } });
      return redactedRadioDistributionDestination(updated);
    });
    return NextResponse.json({ result, notice: "The provider-neutral delivery was queued. Provider acceptance remains external." });
  } catch (error) {
    if (error?.code === "P2002") return NextResponse.json({ error: "This station already has a destination with that provider key and type." }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "The distribution action could not be completed." }, { status: 409 });
  }
}
