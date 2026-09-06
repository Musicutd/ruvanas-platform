import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  createStationDomainVerificationToken,
  normalizeStationDomain,
  normalizeStationWebsiteSettings,
  publicStationWebsitePath,
  stationDomainDnsName,
  stationDomainDnsValue,
  stationDomainTxtVerified
} from "../lib/station-website.mjs";

test("station website settings are bounded and safe for public rendering", () => {
  assert.deepEqual(normalizeStationWebsiteSettings({
    enabled: true,
    headline: "  Malta live  ",
    about: "The station story.",
    heroImageUrl: "https://cdn.example.com/hero.jpg",
    contactEmail: "STUDIO@EXAMPLE.COM",
    theme: "light",
    links: [{ label: " Instagram ", url: "https://instagram.com/example" }]
  }), {
    enabled: true, headline: "Malta live", about: "The station story.",
    heroImageUrl: "https://cdn.example.com/hero.jpg", contactEmail: "studio@example.com",
    theme: "LIGHT", links: [{ label: "Instagram", url: "https://instagram.com/example" }],
    showNowPlaying: true, showPodcasts: true
  });
  assert.throws(() => normalizeStationWebsiteSettings({ heroImageUrl: "http://internal.example/image.jpg" }), /HTTPS/);
  assert.throws(() => normalizeStationWebsiteSettings({ links: [{ label: "Bad", url: "javascript:alert(1)" }] }), /HTTPS/);
  assert.throws(() => normalizeStationWebsiteSettings({ contactEmail: "not-an-email" }), /valid public contact/);
  assert.equal(normalizeStationWebsiteSettings({ showNowPlaying: false, showPodcasts: false }).showNowPlaying, false);
});

test("custom station domains use strict hostnames and deterministic TXT ownership evidence", () => {
  assert.equal(normalizeStationDomain(" Radio.Example.COM. "), "radio.example.com");
  assert.equal(stationDomainDnsName("radio.example.com"), "_ruvanas-radio.radio.example.com");
  assert.equal(stationDomainDnsValue("proof-token"), "ruvanas-verification=proof-token");
  assert.equal(stationDomainTxtVerified([["ruvanas-verification=", "proof-token"]], "proof-token"), true);
  assert.equal(stationDomainTxtVerified([["unrelated"]], "proof-token"), false);
  assert.throws(() => normalizeStationDomain("localhost"), /hostname/);
  assert.throws(() => normalizeStationDomain("station.onrender.com"), /owned by your organisation/);
  assert.throws(() => normalizeStationDomain("https://radio.example.com/path"), /hostname/);
  assert.match(createStationDomainVerificationToken(), /^[A-Za-z0-9_-]{32}$/);
  assert.equal(publicStationWebsitePath("malta-live"), "/radio/malta-live");
});

test("Stage 19.17 keeps public pages separate from tenant and provider controls", async () => {
  const [settingsRoute, domainRoute, publicRoute, nowPlayingRoute, page, middleware, schema, migration] = await Promise.all([
    readFile(new URL("../app/api/stations/[stationId]/website/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/stations/[stationId]/website/domains/[domainId]/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/public/station-websites/[slug]/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/public/station-websites/[slug]/now-playing/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/radio/[slug]/page.js", import.meta.url), "utf8"),
    readFile(new URL("../middleware.js", import.meta.url), "utf8"),
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261018000000_stage_19_17_station_website/migration.sql", import.meta.url), "utf8")
  ]);
  assert.match(settingsRoute, /ORGANISATION_MANAGER_ROLES/);
  assert.match(settingsRoute, /STATION_WEBSITE_PUBLISHED/);
  assert.match(domainRoute, /verifyStationDomainDns/);
  assert.match(domainRoute, /status: "ACTIVE"/);
  assert.doesNotMatch(publicRoute + nowPlayingRoute + page, /providerAccountId|adminPasswordEncrypted|sourcePasswordEncrypted|storageKey/);
  assert.match(nowPlayingRoute, /Cache-Control.*max-age=10/);
  assert.match(middleware, /NextResponse\.rewrite/);
  assert.match(middleware, /station-websites\/domains/);
  assert.match(schema, /hostname\s+String\s+@unique/);
  assert.match(migration, /FOREIGN KEY \("stationId", "organisationId"\)/);
});

test("station-domain normalization remains bounded at directory scale", () => {
  const started = performance.now();
  for (let index = 0; index < 10_000; index += 1) assert.equal(normalizeStationDomain(`radio-${index}.example.com`), `radio-${index}.example.com`);
  assert.ok(performance.now() - started < 1_500);
});
