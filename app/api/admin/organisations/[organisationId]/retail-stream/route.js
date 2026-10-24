import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { encryptSecret } from "@/lib/crypto";
import { RetailStreamOnboardingError } from "@/lib/retail-stream-onboarding.mjs";
import { loadRetailStreamSetup, saveRetailStreamSetup, RetailStreamSetupError } from "@/lib/retail-stream-setup-service.mjs";
import { createRetailStreamSetupHandlers, retailSetupOrigin } from "@/lib/retail-stream-setup-http.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createRetailStreamSetupHandlers({
  getAdmin: requirePlatformAdmin,
  canonicalOrigin: () => retailSetupOrigin(process.env.RUVANAS_PUBLIC_URL, {
    allowLocalHttp: process.env.NODE_ENV === "development"
  }),
  loadSetup: options => loadRetailStreamSetup(prisma, options),
  saveSetup: options => saveRetailStreamSetup(prisma, { ...options, encryptSecret }),
  publicFailure: error => error instanceof RetailStreamSetupError
    ? { status: error.status, code: error.code, message: error.message }
    : error instanceof RetailStreamOnboardingError
      ? { status: 409, code: error.code, message: error.message }
      : null
});

// Saving a private draft never calls Centova or an encoder, and cannot activate
// playback, probing, registration, paid provisioning or a public player.
export const GET = handlers.GET;
export const POST = handlers.POST;
