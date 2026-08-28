import { NextResponse } from "next/server";
import { verifyBillingWebhookSignature } from "@/lib/billing-reconciliation.mjs";
import { processGenericBillingWebhook } from "@/lib/billing-service";

export async function POST(request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-ruvanas-signature");
  const secret = process.env.BILLING_WEBHOOK_SECRET;

  if (!secret || !verifyBillingWebhookSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 });
  }

  const eventId = String(
    request.headers.get("x-ruvanas-event-id") || event?.id || ""
  ).trim();
  if (!eventId) {
    return NextResponse.json({ error: "A provider event ID is required." }, { status: 400 });
  }

  try {
    const result = await processGenericBillingWebhook({ eventId, rawBody, event });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Billing webhook processing error:", error);
    return NextResponse.json(
      { error: "The billing event could not be processed." },
      { status: 500 }
    );
  }
}

