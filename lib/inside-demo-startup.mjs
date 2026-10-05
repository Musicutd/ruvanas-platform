const DEMO_SERVICE = "ruvanas-inside-demo-20260930";
const DEMO_DATABASE_HOST = "dpg-dauktubncjis73fbsdi0-a";
const DEMO_DATABASE_PATH = "/ruvanas_inside_demo";
const DEMO_PUBLIC_URL = "https://ruvanas-inside-demo-20260930.onrender.com";

export function assertInsideDemoStartupEnvironment(environment) {
  let databaseUrl;
  try {
    databaseUrl = new URL(environment.DATABASE_URL || "");
  } catch {
    throw new Error("Inside demo startup requires its exact isolated resources.");
  }
  if (environment.RUVANAS_ENVIRONMENT !== "DEMO" ||
    environment.RENDER_SERVICE_NAME !== DEMO_SERVICE ||
    environment.RUVANAS_PUBLIC_URL !== DEMO_PUBLIC_URL ||
    !["postgres:", "postgresql:"].includes(databaseUrl.protocol) ||
    databaseUrl.hostname !== DEMO_DATABASE_HOST ||
    databaseUrl.pathname !== DEMO_DATABASE_PATH ||
    (databaseUrl.port && databaseUrl.port !== "5432") ||
    databaseUrl.hash ||
    [...databaseUrl.searchParams].some(([key, value]) =>
      !((key === "schema" && value === "public") ||
        (key === "sslmode" && ["require", "verify-ca", "verify-full"].includes(value)))) ||
    new Set(databaseUrl.searchParams.keys()).size !== [...databaseUrl.searchParams].length ||
    (environment.INSIDE_DEMO_OWNER_PASSWORD || "").length < 20) {
    throw new Error("Inside demo startup requires its exact isolated resources.");
  }
  // This tour has no audio, players or Edge. Do not attach any real storage
  // or appliance credentials as part of a routine fictional-demo refresh.
  if (Object.entries(environment).some(([key, value]) =>
    /^(R2_|CORRECTIONS_EDGE_|C8_)/.test(key) && String(value || "").trim())) {
    throw new Error("Inside demo startup refuses storage or Edge configuration.");
  }
}

export async function checkInsideDemoBeforeMigrate({ environment, createDatabase, assertSyntheticDatabase }) {
  assertInsideDemoStartupEnvironment(environment);
  const database = createDatabase();
  try {
    await database.$transaction(async (tx) => {
      // PostgreSQL enforces the read-only contract, including any future
      // change to the synthetic-data validator. No seed or migration here.
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await assertSyntheticDatabase(tx);
    }, { isolationLevel: "Serializable", maxWait: 20_000, timeout: 90_000 });
  } finally {
    await database.$disconnect();
  }
}
