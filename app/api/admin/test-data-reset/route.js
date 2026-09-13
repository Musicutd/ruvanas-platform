import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { SELF_SERVICE_REGISTRATION_ENABLED } from "@/lib/registration-availability.mjs";
import {
  resetSubscriberTestData,
  subscriberTestResetPreview,
  SubscriberTestResetError,
  SUBSCRIBER_TEST_RESET_CONFIRMATION
} from "@/lib/subscriber-test-reset.mjs";

export const dynamic = "force-dynamic";

const resetSchema = z.object({
  retainedEmail: z.string().trim().toLowerCase().email().max(320),
  confirmation: z.literal(SUBSCRIBER_TEST_RESET_CONFIRMATION)
}).strict();

async function superAdminAccess() {
  const access = await requirePlatformAdmin();
  if (!access.ok) return { response: accessDenied(access) };
  if (access.user.role !== "SUPER_ADMIN") {
    return { response: NextResponse.json({ error: "Only a Ruvanas Super Admin can reset subscriber test data." }, { status: 403 }) };
  }
  if (SELF_SERVICE_REGISTRATION_ENABLED) {
    return { response: NextResponse.json({ error: "Subscriber reset is unavailable while public plan registration is enabled." }, { status: 409 }) };
  }
  return { access };
}

export async function GET() {
  try {
    const gate = await superAdminAccess();
    if (gate.response) return gate.response;
    const preview = await subscriberTestResetPreview(prisma, {
      actor: gate.access.user,
      retainedEmail: gate.access.user.email
    });
    return NextResponse.json({ preview, confirmationPhrase: SUBSCRIBER_TEST_RESET_CONFIRMATION });
  } catch (error) {
    const message = error instanceof SubscriberTestResetError ? error.message : "Unable to prepare the reset preview.";
    return NextResponse.json({ error: message }, { status: error instanceof SubscriberTestResetError ? 409 : 500 });
  }
}

export async function POST(request) {
  try {
    const gate = await superAdminAccess();
    if (gate.response) return gate.response;
    const parsed = resetSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: `Enter ${SUBSCRIBER_TEST_RESET_CONFIRMATION} exactly.` }, { status: 400 });
    }
    const result = await resetSubscriberTestData(prisma, {
      actor: gate.access.user,
      ...parsed.data
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error("Subscriber test-data reset failed:", error);
    const message = error instanceof SubscriberTestResetError ? error.message : "The reset could not be completed. No partial deletion was retained.";
    return NextResponse.json({ error: message }, { status: error instanceof SubscriberTestResetError ? 409 : 500 });
  }
}
