import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { catalogueSearchPath, filterSavedPlaylists, musicDuration, onlineRadioPlanningData, playlistFormIssues, playlistFormSnapshot } from "../lib/online-radio-workspace.mjs";
import { workspaceTabFromHash } from "../lib/workspace-tab-navigation.mjs";

const source = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");
test("Online planning scopes metadata by product and hides stale active rows in a draft-only view", () => {
  const data = { canManage: true, sandboxDraftOnly: true, channels: [{ id: "a", productFamily: "ONLINE" }, { id: "b", productFamily: "RETAIL" }],
    playlists: [{ id: "draft", rightsUse: "ONLINE_RADIO", status: "DRAFT" }, { id: "active", rightsUse: "ONLINE_RADIO", status: "ACTIVE" }, { id: "retail", rightsUse: "RETAIL_RADIO", status: "DRAFT" }],
    events: [{ id: "x", channelId: "a" }, { id: "y", channelId: "b" }] };
  const scoped = onlineRadioPlanningData(data);
  assert.deepEqual(scoped.channels.map((row) => row.id), ["a"]);
  assert.deepEqual(scoped.playlists.map((row) => row.id), ["draft"]);
  assert.deepEqual(scoped.events, []);
  const ordinary = onlineRadioPlanningData({ ...data, sandboxDraftOnly: false });
  assert.deepEqual(ordinary.playlists.map((row) => row.id), ["draft", "active"]);
  assert.deepEqual(ordinary.events.map((row) => row.id), ["x"]);
  assert.equal(data.events.length, 2, "presentation scope does not mutate saved source");
});
test("catalogue searches use only the existing Online metadata API with bounded filters", () => {
  const path = catalogueSearchPath({ channelId: "a&x", query: "  Zara & Moon  ", genre: "POP" });
  const url = new URL(path, "https://example.invalid");
  assert.equal(url.pathname, "/api/catalogue/music");
  assert.deepEqual(Object.fromEntries(url.searchParams), { product: "ONLINE", limit: "50", channelId: "a&x", q: "Zara & Moon", genre: "POP" });
  assert.equal(new URL(catalogueSearchPath({ query: "x".repeat(150) }), url).searchParams.get("q").length, 100);
});
test("playlist validation and dirty tracking explain incomplete inputs without a request", () => {
  const playlist = { name: "Morning", durationValue: 1, durationUnit: "HOURS", buildMode: "RANDOM_GENRE_POOL", genreCodes: ["POP"] };
  assert.deepEqual(playlistFormIssues(playlist, { rightsUse: "ONLINE_RADIO" }), []);
  assert.equal(playlistFormSnapshot(playlist), playlistFormSnapshot({ ...playlist, durationValue: "1" }));
  assert.notEqual(playlistFormSnapshot(playlist), playlistFormSnapshot({ ...playlist, genreCodes: ["DANCE"] }));
  assert.equal(playlistFormIssues({ ...playlist, name: "A", durationValue: 0.5, genreCodes: [] }, {}).length, 4);
  assert.match(playlistFormIssues(playlist, { rightsUse: "RETAIL_RADIO" }, "ONLINE_RADIO").join(" "), /Online Radio music-rights profile/);
  assert.deepEqual(filterSavedPlaylists([playlist], " morning "), [playlist]);
  assert.deepEqual(filterSavedPlaylists([playlist], "dance"), []);
  assert.equal(musicDuration(185), "3:05");
  assert.equal(musicDuration(null), "Not supplied");
});
test("Online library needs an explicit metadata grant in sandbox and never starts playback", async () => {
  const ui = await source("app/dashboard/programming/OnlineRadioLibraryWorkspace.js");
  assert.match(ui, /const blockedDraft = sandboxDraftOnly && !catalogueMetadataOnly/);
  assert.match(ui, /if \(blockedDraft\) \{ setLoading\(false\); return; \}/);
  assert.match(ui, /if \(blockedDraft \|\| !setup \|\| \(catalogueMetadataOnly && !channelId\) \|\| view !== "catalogue"\)/);
  assert.match(ui, /if \(blockedDraft\) return <section/);
  assert.doesNotMatch(ui, /<audio|autoPlay|\.play\(|method:\s*"(?:POST|PUT|PATCH|DELETE)"/);
  assert.match(ui, /!catalogueMetadataOnly && view === "uploads" \? <MusicLibraryPro onlineRadioContext/);
  assert.match(ui, /showing the first/);
});
test("Online planning offers three linked steps and safe channel switching", async () => {
  const [page, playlists, tabs] = await Promise.all([source("app/dashboard/programming/page.js"), source("app/dashboard/programming/SimplePlaylistWorkspace.js"), source("app/dashboard/WorkspaceTabs.js")]);
  for (const step of ["1 · Music library", "2 · Playlists", "3 · Weekly planner"]) assert.ok(page.includes(step));
  assert.match(page, /onlineChannelIds=\{onlineChannelIds\}/);
  assert.match(page, /station: \{ productFamily: "ONLINE" \}/);
  assert.match(playlists, /setPlaylistChannelId\(id\)/);
  assert.match(playlists, /Discard your unsaved playlist edits and switch channel/);
  assert.match(playlists, /Programmes or active time slots that use it may select different music/);
  assert.match(playlists, /href="#workspace-planner"/);
  assert.match(tabs, /addEventListener\("hashchange", syncHash\)/);
  assert.match(tabs, /removeEventListener\("hashchange", syncHash\)/);
  assert.match(tabs, /list\.scrollBy\(\{ left, behavior: "auto" \}\)/);
  assert.match(tabs, /focus\(\{ preventScroll: true \}\)/);
  assert.match(tabs, /addEventListener\("resize", revealActiveTab\)/);
  assert.match(tabs, /removeEventListener\("resize", revealActiveTab\)/);
  assert.doesNotMatch(tabs, /scrollIntoView/);
});
test("workspace step links do not intercept planner day anchors or other in-panel links", () => {
  const ids = ["library", "simple", "planner"];
  assert.equal(workspaceTabFromHash("#workspace-planner", ids, "library"), "planner");
  assert.equal(workspaceTabFromHash("#workspace-simple", ids, "library"), "simple");
  assert.equal(workspaceTabFromHash("", ids, "library"), "library");
  for (const hash of ["#planner-day-2026-10-19", "#audio-upload", "#workspace-unknown", "#workspace-planner?bad=1"]) assert.equal(workspaceTabFromHash(hash, ids, "library"), null);
});
