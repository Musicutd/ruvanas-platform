import { requireEnvironmentGroup } from "@/lib/environment.mjs";

function getCentovaEnvironment() {
  return requireEnvironmentGroup(
    ["CENTOVA_API_URL", "CENTOVA_API_USERNAME", "CENTOVA_API_PASSWORD"],
    "Centova API"
  );
}

function buildFormBody(method, args = {}) {
  const params = new URLSearchParams();
  params.set("xm", method);
  params.set("f", "json");

  for (const [key, value] of Object.entries(args)) {
    params.set(`a[${key}]`, value);
  }

  return params;
}

export async function callCentova(method, args = {}) {
  const environment = getCentovaEnvironment();

  const body = buildFormBody(method, args);

  const response = await fetch(environment.CENTOVA_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });

  const rawText = await response.text();

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(
      `Centova API returned a non-JSON response (HTTP ${response.status}): ${rawText.slice(0, 300)}`
    );
  }

  if (parsed.type === "error") {
    throw new Error(
      `Centova API error calling ${method}: ${parsed.response?.message || "Unknown error"}`
    );
  }

  return {
    message: parsed.response?.message || null,
    data: parsed.response?.data ?? null
  };
}

export async function callCentovaAuthenticated(method, args = {}) {
  const environment = getCentovaEnvironment();

  return callCentova(method, {
    username: environment.CENTOVA_API_USERNAME,
    password: environment.CENTOVA_API_PASSWORD,
    ...args
  });
}

export async function provisionAccount({
  username,
  adminpassword,
  sourcepassword,
  hostname,
  title,
  maxbitrate = 128,
  maxclients = 25,
  transferlimit = "unlimited",
  diskquota = "unlimited",
  servertype = "ShoutCast2",
  apptypes = "sctrans",
  autostart = 0
}) {
  if (!username || !adminpassword || !sourcepassword || !hostname) {
    throw new Error(
      "provisionAccount requires: username, adminpassword, sourcepassword, hostname"
    );
  }

  const result = await callCentovaAuthenticated("system.provision", {
    username,
    adminpassword,
    sourcepassword,
    hostname,
    title: title || `${username}'s Radio`,
    ipaddress: "auto",
    port: "auto",
    maxbitrate,
    maxclients,
    transferlimit,
    diskquota,
    servertype,
    apptypes,
    autostart
  });

  return result;
}
