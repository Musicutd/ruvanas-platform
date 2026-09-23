import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { simplePlaylistAccess } from "@/lib/simple-playlist-access";
import { canManageSubscriberProgramming } from "@/lib/subscriber-programming.mjs";
import { subscriberProductAccess } from "@/lib/product-access.mjs";
import { prepareRetailAreaChannel } from "@/lib/retail-area-channel.mjs";
import { isRetryableTransactionError } from "@/lib/transaction-retry.mjs";

const schema = z.object({ zoneId: z.string().cuid() });

export async function POST(request) {
  try {
    const access = await simplePlaylistAccess({ write: true });
    if (access.response) return access.response;
    if (!canManageSubscriberProgramming(access.context.membership.role)) {
      return NextResponse.json({ error: "Only an organisation owner or manager can prepare shop music." }, { status: 403 });
    }
    if (!subscriberProductAccess(access.entitlements, "RETAIL").allowed) {
      return NextResponse.json({ error: "Retail Radio is not included in this account." }, { status: 403 });
    }
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Choose a valid shop area." }, { status: 400 });

    const result = await prepareRetailAreaChannel(prisma, {
      organisationId: access.context.membership.organisationId,
      actorUserId: access.context.user.id,
      zoneId: parsed.data.zoneId,
      streamLimit: access.entitlements.streamLimit
    });
    return NextResponse.json(result, { status: result.ok ? 200 : result.status });
  } catch (error) {
    console.error("Retail area channel preparation error:", error);
    if (isRetryableTransactionError(error)) {
      return NextResponse.json({ error: "Another shop setup is in progress. Please try Save again." }, { status: 409 });
    }
    return NextResponse.json({ error: "Unable to prepare this shop area. Please try again." }, { status: 500 });
  }
}
