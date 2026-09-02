import { acceptableRedirect } from "../lib/release-quality.mjs";

const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:3100";
const results = [];

async function request(path, options = {}) {
  return fetch(`${baseUrl}${path}`, { redirect: "manual", ...options });
}

async function expectPublicPage(path, phrase) {
  const response = await request(path);
  const body = await response.text();
  if (response.status !== 200 || !body.includes(phrase)) {
    throw new Error(`${path} failed the public-page smoke check with status ${response.status}.`);
  }
  results.push({ path, status: response.status, expectation: "PUBLIC_PAGE" });
}

async function expectProtectedPage(path) {
  const response = await request(path);
  const location = response.headers.get("location");
  if (!acceptableRedirect(response.status, location)) {
    throw new Error(`${path} did not redirect an unauthenticated request to login.`);
  }
  results.push({ path, status: response.status, expectation: "LOGIN_REDIRECT" });
}

async function expectProtectedApi(path) {
  const response = await request(path, { headers: { accept: "application/json" } });
  if (response.status !== 401 || !response.headers.get("x-request-id")) {
    throw new Error(`${path} did not return an attributable unauthenticated API response.`);
  }
  results.push({ path, status: response.status, expectation: "AUTHENTICATED_API" });
}

await expectPublicPage("/", "Every space deserves its");
await expectPublicPage("/login", "Welcome back");
await expectPublicPage("/register", "Create your account");
await expectPublicPage("/player", "Connecting player...");
await expectProtectedPage("/dashboard");
await expectProtectedPage("/admin/recovery");
await expectProtectedApi("/api/admin/recovery");
await expectProtectedApi("/api/admin/operations/health");
await expectProtectedApi("/api/notifications");

process.stdout.write(JSON.stringify({ event: "release_smoke_passed", baseUrl, checks: results }) + "\n");
