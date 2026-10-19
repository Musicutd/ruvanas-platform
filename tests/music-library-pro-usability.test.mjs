import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/dashboard/media/MusicLibraryPro.js", import.meta.url), "utf8");
const helperSource = source.slice(source.indexOf("const USE_LABELS"), source.indexOf("export default function MusicLibraryPro"))
  .replace(/^export /gm, "");
const { filterOrganisationMusicTracks, dateLabel, readMusicResponse, organisationMusicCatalogueNavigation, validateOrganisationMusicLibrary, observeHiddenMusicPanel } = new Function(`${helperSource}\nreturn { filterOrganisationMusicTracks, dateLabel, readMusicResponse, organisationMusicCatalogueNavigation, validateOrganisationMusicLibrary, observeHiddenMusicPanel };`)();
const track = (id, extra = {}) => ({ id, title: "Morning song", artist: "Beyoncé", album: "Local recording", rightsReviewStatus: "DRAFT", permittedUses: ["ONLINE_RADIO"], file: { originalName: "Morning song.mp3" }, ...extra });

test("organisation music searches title, artist, album and filenames without changing records", () => {
  const tracks = [track("a"), track("b", { title: "Different", artist: "歌手", album: "夜", file: { originalName: "私の歌.mp3" } })];
  const before = structuredClone(tracks);
  assert.deepEqual(filterOrganisationMusicTracks(tracks, { query: "beyonce morning" }).map(item => item.id), ["a"]);
  assert.deepEqual(filterOrganisationMusicTracks(tracks, { query: "local recording" }).map(item => item.id), ["a"]);
  assert.deepEqual(filterOrganisationMusicTracks(tracks, { query: "私の歌" }).map(item => item.id), ["b"]);
  assert.deepEqual(filterOrganisationMusicTracks(tracks, { query: "missing" }), []);
  assert.deepEqual(tracks, before);
});

test("status and declared-service filters combine and keep pending music distinct from approval", () => {
  const tracks = [track("draft"), track("rejected", { rightsReviewStatus: "REJECTED" }), track("pending", { rightsReviewStatus: "IN_REVIEW" }), track("approved", { rightsReviewStatus: "APPROVED", permittedUses: ["SCHOOL_RADIO"] })];
  assert.deepEqual(filterOrganisationMusicTracks(tracks, { status: "NEEDS_ACTION" }).map(item => item.id), ["draft", "rejected"]);
  assert.deepEqual(filterOrganisationMusicTracks(tracks, { status: "APPROVED", use: "ONLINE_RADIO" }), []);
  assert.deepEqual(filterOrganisationMusicTracks(tracks, { status: "APPROVED", use: "SCHOOL_RADIO" }).map(item => item.id), ["approved"]);
  assert.deepEqual(filterOrganisationMusicTracks(tracks, { query: "   " }), tracks);
});

test("licence dates handle missing and malformed values without crashing the library", () => {
  assert.equal(dateLabel(null, "No expiry recorded"), "No expiry recorded");
  assert.equal(dateLabel("invalid"), "Date unavailable");
  assert.equal(dateLabel("2026-10-19"), "19 Oct 2026");
});

test("unreadable refresh or mutation responses give a retry-safe message", async () => {
  await assert.rejects(readMusicResponse({ ok: false, json: async () => { throw new SyntaxError("Unexpected token <"); } }, "Fallback"), /refreshing before repeating an upload or submission/);
  await assert.rejects(readMusicResponse({ ok: false, json: async () => ({ error: "Your account cannot upload." }) }, "Fallback"), /Your account cannot upload/);
  await assert.rejects(readMusicResponse({ ok: false, json: async () => ({ error: {} }) }, "Safe fallback"), /Safe fallback/);
  assert.deepEqual(await readMusicResponse({ ok: true, json: async () => ({ tracks: [] }) }, "Fallback"), { tracks: [] });
});

test("manually starting a preview pauses other previews without starting audio itself", () => {
  const body = source.slice(source.indexOf("  function previewOne(event) {"), source.indexOf("  async function upload(event) {"));
  const first = { pauses: 0, pause() { this.pauses++; } };
  const second = { pauses: 0, pause() { this.pauses++; } };
  const previewOne = new Function("audioList", `${body}\nreturn previewOne;`)({ current: { querySelectorAll: () => [first, second] } });
  previewOne({ currentTarget: first });
  assert.equal(first.pauses, 0);
  assert.equal(second.pauses, 1);
});

test("UI keeps private uploads separate, permission-gated and explicitly manual to preview", () => {
  assert.match(source, /Your uploaded music/);
  assert.match(source, /Ruvanas music catalogue/);
  assert.match(source, /not copied into this list/);
  assert.match(source, /library\.permissions\.canUpload \?/);
  assert.match(source, /library\.permissions\.canSubmit && \["DRAFT", "REJECTED"\]/);
  assert.match(source, /<fieldset disabled=\{working\}/);
  assert.match(source, /<audio controls preload="none"/);
  assert.doesNotMatch(source, /autoPlay|\.play\(/);
  assert.match(source, /No tracks match these filters/);
  assert.match(source, /Show all organisation music/);
  assert.match(source, /role="search"/);
  assert.match(source, /role="status" aria-live="polite"/);
  assert.match(source, /Try again/);
  const endpoints = [...source.matchAll(/fetch\(("[^"]+"|`[^`]+`)/g)].map(match => match[1]);
  assert.deepEqual(endpoints, ['"/api/media/music"', '"/api/media/music"', '`/api/media/music/${trackId}/submit`']);
});

test("new declarations require explicit service selection", () => {
  assert.match(source, /name="permittedUses" value=\{value\} \/>/);
  assert.doesNotMatch(source, /defaultChecked/);
  assert.match(source, /Select only the services explicitly covered by your documented permission/);
  assert.match(source, /Nothing is selected automatically/);
});

test("catalogue navigation uses the current service unless explicitly in Online Radio", () => {
  const generic = { href: "/dashboard/programming", label: "Browse music for your service →" };
  assert.deepEqual(organisationMusicCatalogueNavigation(), generic);
  assert.deepEqual(organisationMusicCatalogueNavigation(false), generic);
  assert.deepEqual(organisationMusicCatalogueNavigation("true"), generic);
  assert.deepEqual(organisationMusicCatalogueNavigation(true), {
    href: "/dashboard/programming?product=ONLINE#workspace-library", label: "Browse Online Radio catalogue →"
  });
  assert.match(source, /MusicLibraryPro\(\{ onlineRadioContext = false \} = \{\}\)/);
  assert.match(source, /href=\{catalogueNavigation\.href\}/);
});

test("a successful response missing organisation identity fails into the controlled retry state", () => {
  const valid = { tracks: [], permissions: { canUpload: false, canSubmit: false }, organisation: { name: "Synthetic organisation" } };
  assert.equal(validateOrganisationMusicLibrary(valid), valid);
  for (const invalid of [null, {}, { ...valid, tracks: null }, { ...valid, permissions: null },
    { ...valid, organisation: null }, { ...valid, organisation: {} },
    { ...valid, organisation: { name: " " } }, { ...valid, organisation: { name: 42 } }]) {
    assert.throws(() => validateOrganisationMusicLibrary(invalid), /Please try refreshing/);
  }
  assert.match(source, /validateOrganisationMusicLibrary\(await readMusicResponse/);
});

test("hidden workspace panels pause their manual previews and clean up the observer", () => {
  const panel = { hidden: false };
  const players = [{ pauses: 0, pause() { this.pauses++; } }, { pauses: 0, pause() { this.pauses++; } }];
  const list = { closest: (selector) => { assert.equal(selector, '[role="tabpanel"]'); return panel; }, querySelectorAll: () => players };
  let callback, observed, disconnected = 0, constructed = 0;
  class Observer {
    constructor(handler) { constructed++; callback = handler; }
    observe(target, options) { observed = { target, options }; }
    disconnect() { disconnected++; }
  }
  const cleanup = observeHiddenMusicPanel(list, Observer);
  assert.equal(constructed, 1);
  assert.equal(observed.target, panel);
  assert.deepEqual(observed.options, { attributes: true, attributeFilter: ["hidden"] });
  assert.deepEqual(players.map(player => player.pauses), [0, 0]);
  panel.hidden = true; callback();
  assert.deepEqual(players.map(player => player.pauses), [1, 1]);
  panel.hidden = false; callback();
  assert.deepEqual(players.map(player => player.pauses), [1, 1]);
  cleanup(); assert.equal(disconnected, 1);
  observeHiddenMusicPanel({ closest: () => null }, Observer)();
  assert.equal(constructed, 1, "global media pages do not construct an observer");
  assert.match(source, /useEffect\(\(\) => observeHiddenMusicPanel\(audioList\.current\), \[library\]\)/);
});
