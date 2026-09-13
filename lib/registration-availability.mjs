export const SELF_SERVICE_REGISTRATION_ENABLED = false;

export const SELF_SERVICE_REGISTRATION_MESSAGE =
  "Plan registration is temporarily unavailable while Ruvanas completes its payment setup. If a Super Admin sent you a free-access code, you can still create your eligible account with that code.";

const LOCAL_ACCEPTANCE_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function isLocalUrl(value) {
  try {
    return LOCAL_ACCEPTANCE_HOSTS.has(new URL(value).hostname);
  } catch {
    return false;
  }
}

export function isInternalRegistrationTestRequest(request, environment = process.env) {
  const expectedKey = String(environment.INTERNAL_REGISTRATION_TEST_KEY || "");
  const suppliedKey = String(request?.headers?.get?.("x-ruvanas-registration-test-key") || "");
  return (
    environment.RUN_DATABASE_TESTS === "1" &&
    expectedKey.length >= 32 &&
    suppliedKey === expectedKey &&
    isLocalUrl(request?.url) &&
    isLocalUrl(environment.DATABASE_URL)
  );
}
