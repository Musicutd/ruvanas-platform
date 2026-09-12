import { NextResponse } from "next/server";
import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { healthFaithProduct, normalizeAudiencePolicy } from "@/lib/health-faith-core.mjs";
import { isWithinLimit } from "@/lib/entitlements.mjs";
import { isOrganisationRoleAllowed, ORGANISATION_MANAGER_ROLES } from "@/lib/permissions.mjs";
import { prisma } from "@/lib/prisma";
import slugify from "@/lib/slugify";

async function access(productKey) {
  const product = healthFaithProduct(productKey);
  if (!product) return { error: "Choose Health or Faith.", status: 400 };
  const context = await getActiveOrganisationContext({
    subscription: { include: { plan: true, billingContract: true } },
    stations: { where: { productFamily: product.key }, include: { channels: true }, orderBy: { createdAt: "asc" } }
  });
  if (!context?.membership) return { error: "Sign in and choose your organisation.", status: 401 };
  const entitlements = resolveEntitlements(context.membership.organisation.subscription);
  if (!entitlements.serviceEnabled || !entitlements[product.capability]) return { error: `${product.label} is not included in this organisation's active plan.`, status: 403 };
  return { context, entitlements, product };
}

export async function GET(request) {
  const result = await access(new URL(request.url).searchParams.get("product"));
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ product: result.product, stations: result.context.membership.organisation.stations });
}

export async function POST(request) {
  const body = await request.json();
  const result = await access(body.product);
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
  const { context, entitlements, product } = result;
  if (!isOrganisationRoleAllowed(context.membership.role, ORGANISATION_MANAGER_ROLES)) return NextResponse.json({ error: "Only an organisation owner or manager can change channels." }, { status: 403 });
  const organisation = context.membership.organisation;
  const name = String(body.name || "").trim().slice(0, 120);
  if (name.length < 2) return NextResponse.json({ error: "Enter a channel name." }, { status: 400 });
  if (!isWithinLimit(organisation.stations.length, entitlements.stationLimit)) return NextResponse.json({ error: `Your plan allows ${entitlements.stationLimit} ${product.label} channel${entitlements.stationLimit === 1 ? "" : "s"}.` }, { status: 403 });
  const audiencePolicy = normalizeAudiencePolicy(body.audiencePolicy, product.key);
  const station = await prisma.$transaction(async (tx) => {
    const created = await tx.station.create({ data: {
      organisationId: organisation.id, productFamily: product.key, name,
      description: String(body.description || "").trim().slice(0, 500) || null,
      slug: `${slugify(name)}-${Math.random().toString(36).slice(2, 7)}`, status: "ACTIVE",
      audiencePolicy, publicPlayerEnabled: false,
      listenerRequestsEnabled: product.key === "HEALTH" && Boolean(body.listenerRequestsEnabled),
      listenerRequestInstructions: product.key === "HEALTH" ? "Share only a song or artist. Do not include medical or patient information." : null,
      listenerLimit: entitlements.listenerLimit, storageLimitGb: entitlements.storageLimitGb, maxBitrateKbps: entitlements.maxBitrateKbps,
      channels: { create: { name, slug: `${slugify(name)}-${Math.random().toString(36).slice(2, 7)}`, status: "ACTIVE" } }
    }, include: { channels: true } });
    await tx.auditLog.create({ data: { organisationId: organisation.id, actorUserId: context.user.id, action: `${product.key}_CHANNEL_CREATED`, entityType: "Station", entityId: created.id, details: { audiencePolicy, planCode: entitlements.planCode } } });
    return created;
  });
  return NextResponse.json({ success: true, station }, { status: 201 });
}
