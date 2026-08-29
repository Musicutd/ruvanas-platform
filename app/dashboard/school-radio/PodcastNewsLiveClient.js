"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const storyLabels = { NEWS_BULLETIN: "News bulletin", INTERVIEW: "Interview", SPORTS_RESULT: "Sports result", SCHOOL_NOTICE: "School notice", FEATURE_STORY: "Feature story" };
const nextStoryAction = { PITCH: "ASSIGN", ASSIGNED: "START_SCRIPT", SCRIPTING: "FACT_CHECK", FACT_CHECK: "START_AUDIO", AUDIO_PRODUCTION: "SUBMIT", IN_REVIEW: "APPROVE", APPROVED: "PUBLISH" };

function clock(ms) {
  const seconds = Math.floor(Number(ms || 0) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function parseClock(value) {
  const [minutes, seconds] = String(value || "0:0").split(":").map(Number);
  return Math.max(0, Math.round(((minutes || 0) * 60 + (seconds || 0)) * 1000));
}

function transcriptText(segments = []) {
  return segments.map((item) => `${clock(item.startMs)}-${clock(item.endMs)} | ${item.speaker || "Presenter"} | ${item.text}`).join("\n");
}

function parseTranscript(value) {
  return String(value || "").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const [range = "", speaker = "Presenter", ...text] = line.split("|").map((item) => item.trim());
    const [start, end] = range.split("-").map((item) => item.trim());
    return { startMs: parseClock(start), endMs: Math.max(parseClock(end), parseClock(start) + 1000), speaker, text: text.join(" | ") };
  });
}

function chaptersText(chapters = []) {
  return chapters.map((item) => `${clock(item.startMs)} | ${item.title}`).join("\n");
}

function parseChapters(value) {
  return String(value || "").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const [time, ...title] = line.split("|").map((item) => item.trim());
    return { startMs: parseClock(time), title: title.join(" | ") };
  });
}

function Badge({ value }) {
  return <span style={styles.badge}>{String(value || "UNKNOWN").replaceAll("_", " ")}</span>;
}

export default function PodcastNewsLiveClient() {
  const [podcasts, setPodcasts] = useState(null);
  const [newsroom, setNewsroom] = useState(null);
  const [live, setLive] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const [series, setSeries] = useState({ title: "", description: "", programmeId: "" });
  const [podcastEpisode, setPodcastEpisode] = useState({ seriesId: "", episodeId: "", accessibleDescription: "" });
  const [podcastDrafts, setPodcastDrafts] = useState({});
  const [story, setStory] = useState({ title: "", type: "NEWS_BULLETIN", pitch: "", deadline: "", programmeId: "", episodeId: "" });
  const [storyDrafts, setStoryDrafts] = useState({});
  const [session, setSession] = useState({ title: "", programmeId: "", episodeId: "", channelId: "", fallbackPromoVersionId: "", scheduledStart: "", scheduledEnd: "", recordEnabled: false, retentionApproved: false });
  const [deviceId, setDeviceId] = useState("");
  const [devices, setDevices] = useState([]);

  const load = useCallback(async () => {
    const paths = ["/api/school-radio/podcasts", "/api/school-radio/newsroom", "/api/school-radio/live-studio"];
    const responses = await Promise.all(paths.map((path) => fetch(path, { cache: "no-store" })));
    const payloads = await Promise.all(responses.map((response) => response.json().catch(() => ({}))));
    const failed = responses.findIndex((response) => !response.ok);
    if (failed >= 0) throw new Error(payloads[failed].error || "Stage 4G could not be loaded.");
    setPodcasts(payloads[0]); setNewsroom(payloads[1]); setLive(payloads[2]);
  }, []);

  useEffect(() => { load().catch((loadError) => setError(loadError.message)); }, [load]);

  async function act(path, body, success) {
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The action could not be completed.");
      setNotice(success);
      await load();
      return payload;
    } catch (actionError) { setError(actionError.message); return null; } finally { setWorking(false); }
  }

  async function createSeries(event) {
    event.preventDefault();
    if (await act("/api/school-radio/podcasts", { action: "CREATE_SERIES", ...series, programmeId: series.programmeId || null }, "Podcast series created as private.")) setSeries({ title: "", description: "", programmeId: "" });
  }

  async function createPodcastEpisode(event) {
    event.preventDefault();
    if (await act("/api/school-radio/podcasts", { action: "CREATE_EPISODE", ...podcastEpisode }, "Approved episode added to the podcast editor.")) setPodcastEpisode({ seriesId: "", episodeId: "", accessibleDescription: "" });
  }

  function podcastDraft(item) {
    return podcastDrafts[item.id] || { languageCode: item.transcript?.languageCode || "en", transcript: transcriptText(item.transcript?.segmentsJson || []), chapters: chaptersText(item.chaptersJson || []), accessibleDescription: item.accessibleDescription || "" };
  }

  async function savePodcast(item, submitTranscript) {
    const draft = podcastDraft(item);
    await act("/api/school-radio/podcasts", { action: "SAVE_EDITOR", podcastEpisodeId: item.id, languageCode: draft.languageCode, transcriptSegments: parseTranscript(draft.transcript), chapters: parseChapters(draft.chapters), accessibleDescription: draft.accessibleDescription || null, submitTranscript }, submitTranscript ? "Podcast editor saved and transcript sent for staff review." : "Podcast editor saved privately.");
  }

  async function unpublishPodcast(item) {
    const reason = window.prompt("Why is this podcast being unpublished?", "School publication withdrawn for review.");
    if (!reason?.trim()) return;
    await act("/api/school-radio/podcasts", { action: "UNPUBLISH", podcastEpisodeId: item.id, reason }, "Podcast access removed immediately; the decision remains in the audit history.");
  }

  async function createStory(event) {
    event.preventDefault();
    const payload = { ...story, action: "CREATE", deadline: story.deadline ? new Date(story.deadline).toISOString() : null, programmeId: story.programmeId || null, episodeId: story.episodeId || null };
    if (await act("/api/school-radio/newsroom", payload, "Newsroom pitch created.")) setStory({ title: "", type: "NEWS_BULLETIN", pitch: "", deadline: "", programmeId: "", episodeId: "" });
  }

  function newsDraft(item) {
    return storyDrafts[item.id] || { script: item.script || "", factCheckNotes: item.factCheckNotes || "", sources: (item.sourcesJson || []).map((source) => `${source.label} | ${source.url || ""}`).join("\n"), interviewMediaAssetId: item.interviewMediaAssetId || "", interviewConsentConfirmed: item.interviewConsentConfirmed };
  }

  async function saveStory(item) {
    const draft = newsDraft(item);
    const sources = draft.sources.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => { const [label, ...url] = line.split("|").map((part) => part.trim()); return { label, url: url.join(" | ") || null }; });
    await act("/api/school-radio/newsroom", { action: "SAVE", storyId: item.id, script: draft.script || null, factCheckNotes: draft.factCheckNotes || null, sources, interviewMediaAssetId: draft.interviewMediaAssetId || null, interviewConsentConfirmed: draft.interviewConsentConfirmed }, "Newsroom story saved.");
  }

  async function progressStory(item, action) {
    let notes = null;
    if (action === "REQUEST_CHANGES") notes = window.prompt("Teacher feedback:", "");
    if (action === "ARCHIVE") notes = window.prompt("Archive reason:", "");
    if (new Set(["REQUEST_CHANGES", "ARCHIVE"]).has(action) && !notes?.trim()) return;
    await act("/api/school-radio/newsroom", { action, storyId: item.id, notes }, `Story moved to ${action.replaceAll("_", " ").toLowerCase()}.`);
  }

  async function createSession(event) {
    event.preventDefault();
    const payload = { ...session, action: "CREATE", episodeId: session.episodeId || null, scheduledStart: new Date(session.scheduledStart).toISOString(), scheduledEnd: new Date(session.scheduledEnd).toISOString() };
    if (await act("/api/school-radio/live-studio", payload, "Live session created with approved fallback audio.")) setSession({ title: "", programmeId: "", episodeId: "", channelId: "", fallbackPromoVersionId: "", scheduledStart: "", scheduledEnd: "", recordEnabled: false, retentionApproved: false });
  }

  async function runSoundcheck(item) {
    setWorking(true); setError(""); setNotice("");
    let stream;
    try {
      if (item.status === "CREATED") {
        const started = await fetch("/api/school-radio/live-studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "START_SOUNDCHECK", sessionId: item.id }) });
        if (!started.ok) throw new Error((await started.json().catch(() => ({}))).error || "Soundcheck could not start.");
      }
      stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true });
      const available = await navigator.mediaDevices.enumerateDevices();
      const microphones = available.filter((device) => device.kind === "audioinput");
      setDevices(microphones);
      if (!deviceId && microphones[0]) setDeviceId(microphones[0].deviceId);
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      await new Promise((resolve) => setTimeout(resolve, 700));
      analyser.getByteTimeDomainData(samples);
      const levelDetected = samples.some((value) => Math.abs(value - 128) > 2);
      await context.close();
      const pingStartedAt = performance.now();
      const ping = await fetch("/api/school-radio/live-studio", { cache: "no-store" });
      const latencyMs = Math.max(1, Math.round(performance.now() - pingStartedAt));
      const response = await fetch("/api/school-radio/live-studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "SAVE_SOUNDCHECK", sessionId: item.id, deviceLabel: microphones.find((device) => device.deviceId === (deviceId || microphones[0]?.deviceId))?.label || "Browser microphone", latencyMs, packetLossPercent: ping.ok ? 0 : 100, microphoneDetected: true, levelDetected }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Soundcheck could not be saved.");
      setNotice(`Soundcheck complete: ${payload.session.connectionQuality.toLowerCase()} connection.`);
      await load();
    } catch (soundcheckError) { setError(soundcheckError.message || "Allow microphone access and try again."); } finally { stream?.getTracks().forEach((track) => track.stop()); setWorking(false); }
  }

  async function liveAction(item, action) {
    let reason = null;
    if (new Set(["FORCE_FALLBACK", "END"]).has(action)) reason = window.prompt(action === "END" ? "Reason for ending this broadcast:" : "Reason for forcing fallback:", "");
    if (new Set(["FORCE_FALLBACK", "END"]).has(action) && !reason?.trim()) return;
    const payload = await act("/api/school-radio/live-studio", { action, sessionId: item.id, reason }, action === "GO_LIVE" ? "Go-live approved. The short-lived session token was issued securely." : `Live session updated: ${action.replaceAll("_", " ").toLowerCase()}.`);
    if (payload?.goLiveToken) window.alert("Go-live token issued for this browser session. It is not displayed or stored in page history.");
  }

  const allPodcastEpisodes = useMemo(() => (podcasts?.series || []).flatMap((item) => item.episodes), [podcasts]);
  if (!podcasts || !newsroom || !live) return <section style={styles.shell}><p>{error || "Loading Podcast, Newsroom, and Live Studio…"}</p></section>;

  return <section style={styles.shell}>
    <div style={styles.heading}><div><p style={styles.eyebrow}>PODCAST · NEWSROOM · LIVE STUDIO</p><h2 style={styles.title}>Publish stories and supervise live radio</h2><p style={styles.muted}>Internal publishing remains available to managers. Public podcast release is available only when Stage 9C capability, policy, safeguarding, transcript, audio, and consent checks all pass.</p></div><Badge value="STAFF SUPERVISED" /></div>
    {error ? <div style={styles.error}>{error}</div> : null}{notice ? <div style={styles.notice}>{notice}</div> : null}

    <div style={styles.columns}>
      <form onSubmit={createSeries} style={styles.card}><p style={styles.eyebrow}>PODCAST EDITOR</p><h3>Create a private series</h3><label style={styles.label}>Series title<input style={styles.input} value={series.title} onChange={(event) => setSeries({ ...series, title: event.target.value })} required /></label><label style={styles.label}>Programme<select style={styles.input} value={series.programmeId} onChange={(event) => setSeries({ ...series, programmeId: event.target.value })}><option value="">No programme link</option>{podcasts.programmes.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label style={styles.label}>Description<textarea style={styles.textarea} value={series.description} onChange={(event) => setSeries({ ...series, description: event.target.value })} /></label><button style={styles.primary} disabled={working}>Create series</button></form>
      <form onSubmit={createPodcastEpisode} style={styles.card}><p style={styles.eyebrow}>APPROVED AUDIO ONLY</p><h3>Add episode to editor</h3><label style={styles.label}>Series<select style={styles.input} value={podcastEpisode.seriesId} onChange={(event) => setPodcastEpisode({ ...podcastEpisode, seriesId: event.target.value })} required><option value="">Choose series…</option>{podcasts.series.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label style={styles.label}>Approved episode<select style={styles.input} value={podcastEpisode.episodeId} onChange={(event) => setPodcastEpisode({ ...podcastEpisode, episodeId: event.target.value })} required><option value="">Choose episode…</option>{podcasts.eligibleEpisodes.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label style={styles.label}>Accessible description<textarea style={styles.textarea} value={podcastEpisode.accessibleDescription} onChange={(event) => setPodcastEpisode({ ...podcastEpisode, accessibleDescription: event.target.value })} /></label><button style={styles.primary} disabled={working || !podcasts.series.length || !podcasts.eligibleEpisodes.length}>Open in Podcast Editor</button></form>
    </div>

      <div style={styles.list}>{allPodcastEpisodes.map((item) => { const draft = podcastDraft(item); const publiclyLive = item.status === "PUBLISHED" && item.publicationScope === "PUBLIC"; return <article key={item.id} style={styles.card}><div style={styles.row}><div><h3 style={styles.itemTitle}>{item.episode.title}</h3><p style={styles.muted}>Reuses the approved school episode master · {item.publicationScope.replaceAll("_", " ").toLowerCase()}</p></div><div style={styles.actions}><Badge value={item.transcript?.status || "NO TRANSCRIPT"} /><Badge value={item.status} /></div></div><div style={styles.columns}><label style={styles.label}>Transcript — one line: start-end | speaker | words<textarea style={styles.editor} value={draft.transcript} onChange={(event) => setPodcastDrafts({ ...podcastDrafts, [item.id]: { ...draft, transcript: event.target.value } })} placeholder="00:00-00:08 | Presenter | Welcome to our programme." /></label><label style={styles.label}>Chapters — one line: time | title<textarea style={styles.editor} value={draft.chapters} onChange={(event) => setPodcastDrafts({ ...podcastDrafts, [item.id]: { ...draft, chapters: event.target.value } })} placeholder="00:00 | Opening" /></label></div><label style={styles.label}>Accessible description<textarea style={styles.textarea} value={draft.accessibleDescription} onChange={(event) => setPodcastDrafts({ ...podcastDrafts, [item.id]: { ...draft, accessibleDescription: event.target.value } })} /></label><div style={styles.actions}><button style={styles.secondary} disabled={working} onClick={() => savePodcast(item, false)}>Save privately</button><button style={styles.primary} disabled={working} onClick={() => savePodcast(item, true)}>Submit transcript</button>{podcasts.permissions.canApproveTranscript && item.transcript?.status === "NEEDS_REVIEW" ? <button style={styles.approve} disabled={working} onClick={() => act("/api/school-radio/podcasts", { action: "APPROVE_TRANSCRIPT", podcastEpisodeId: item.id }, "Transcript approved by staff.")}>Approve transcript</button> : null}{podcasts.permissions.canPublish && item.status !== "PUBLISHED" ? <button style={styles.approve} disabled={working} onClick={() => act("/api/school-radio/podcasts", { action: "PUBLISH", podcastEpisodeId: item.id, publicationScope: "INTERNAL_ONLY" }, "Podcast published internally.")}>Publish internally</button> : null}{podcasts.permissions.canPublish && podcasts.permissions.publicPublishingEnabled && item.transcript?.status === "APPROVED" && !publiclyLive ? <button style={styles.approve} disabled={working} onClick={() => act("/api/school-radio/podcasts", { action: "PUBLISH", podcastEpisodeId: item.id, publicationScope: "PUBLIC" }, "Podcast passed Stage 9C controls and is now public.")}>Publish publicly</button> : null}{podcasts.permissions.canPublish && item.status === "PUBLISHED" ? <button style={styles.danger} disabled={working} onClick={() => unpublishPodcast(item)}>Unpublish</button> : null}{publiclyLive ? <a style={styles.publicLink} href={podcasts.publicUrl} target="_blank" rel="noreferrer">Open public page</a> : null}</div>{item.publicationDecisions?.[0] ? <p style={styles.audit}>Latest public decision: {item.publicationDecisions[0].decision.replaceAll("_", " ").toLowerCase()} · {new Date(item.publicationDecisions[0].createdAt).toLocaleString()}{item.publicationDecisions[0].reason ? ` · ${item.publicationDecisions[0].reason}` : ""}</p> : null}</article>; })}</div>

    <div style={styles.divider} />
    <div style={styles.columns}>
      <form onSubmit={createStory} style={styles.card}><p style={styles.eyebrow}>SCHOOL NEWSROOM</p><h3>New story pitch</h3><label style={styles.label}>Headline<input style={styles.input} value={story.title} onChange={(event) => setStory({ ...story, title: event.target.value })} required /></label><label style={styles.label}>Template<select style={styles.input} value={story.type} onChange={(event) => setStory({ ...story, type: event.target.value })}>{newsroom.templates.map((item) => <option key={item} value={item}>{storyLabels[item]}</option>)}</select></label><label style={styles.label}>Pitch<textarea style={styles.textarea} value={story.pitch} onChange={(event) => setStory({ ...story, pitch: event.target.value })} /></label><label style={styles.label}>Deadline<input type="datetime-local" style={styles.input} value={story.deadline} onChange={(event) => setStory({ ...story, deadline: event.target.value })} /></label><button style={styles.primary} disabled={working}>Create pitch</button></form>
      <aside style={styles.card}><p style={styles.eyebrow}>EDITORIAL WORKFLOW</p><h3>Supervised by design</h3><p style={styles.muted}>Pitch → assignment → script → fact check → audio production → teacher review → approved publication.</p><p style={styles.warning}>Interview audio cannot be approved until guest consent is confirmed. Sources store citation details and links—not uncontrolled copies.</p></aside>
    </div>
    <div style={styles.list}>{newsroom.stories.map((item) => { const draft = newsDraft(item); const next = nextStoryAction[item.status]; return <article key={item.id} style={styles.card}><div style={styles.row}><div><h3 style={styles.itemTitle}>{item.title}</h3><p style={styles.muted}>{storyLabels[item.type]}{item.deadline ? ` · due ${new Date(item.deadline).toLocaleString()}` : ""}</p></div><Badge value={item.status} /></div><div style={styles.columns}><label style={styles.label}>Script<textarea style={styles.editor} value={draft.script} onChange={(event) => setStoryDrafts({ ...storyDrafts, [item.id]: { ...draft, script: event.target.value } })} /></label><label style={styles.label}>Fact-check notes<textarea style={styles.editor} value={draft.factCheckNotes} onChange={(event) => setStoryDrafts({ ...storyDrafts, [item.id]: { ...draft, factCheckNotes: event.target.value } })} /></label></div><label style={styles.label}>Sources — one line: label | optional URL<textarea style={styles.textarea} value={draft.sources} onChange={(event) => setStoryDrafts({ ...storyDrafts, [item.id]: { ...draft, sources: event.target.value } })} /></label>{item.type === "INTERVIEW" ? <div style={styles.columns}><label style={styles.label}>Interview recording<select style={styles.input} value={draft.interviewMediaAssetId} onChange={(event) => setStoryDrafts({ ...storyDrafts, [item.id]: { ...draft, interviewMediaAssetId: event.target.value } })}><option value="">Choose protected audio…</option>{newsroom.interviewAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label><label style={styles.check}><input type="checkbox" checked={draft.interviewConsentConfirmed} onChange={(event) => setStoryDrafts({ ...storyDrafts, [item.id]: { ...draft, interviewConsentConfirmed: event.target.checked } })} /> Guest/interview consent confirmed</label></div> : null}<div style={styles.actions}><button style={styles.secondary} disabled={working} onClick={() => saveStory(item)}>Save story</button>{next && (!new Set(["ASSIGN", "APPROVE", "PUBLISH"]).has(next) || newsroom.permissions.canModerate) ? <button style={styles.primary} disabled={working} onClick={() => progressStory(item, next)}>{next.replaceAll("_", " ")}</button> : null}{newsroom.permissions.canModerate && item.status === "IN_REVIEW" ? <button style={styles.danger} disabled={working} onClick={() => progressStory(item, "REQUEST_CHANGES")}>Request changes</button> : null}</div></article>; })}</div>

    <div style={styles.divider} />
    <div style={styles.columns}>
      <form onSubmit={createSession} style={styles.card}><p style={styles.eyebrow}>LIVE STUDIO</p><h3>Prepare supervised session</h3><label style={styles.label}>Session title<input style={styles.input} value={session.title} onChange={(event) => setSession({ ...session, title: event.target.value })} required /></label><label style={styles.label}>Programme<select style={styles.input} value={session.programmeId} onChange={(event) => setSession({ ...session, programmeId: event.target.value, episodeId: "" })} required><option value="">Choose programme…</option>{live.programmes.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label style={styles.label}>Episode (optional)<select style={styles.input} value={session.episodeId} onChange={(event) => setSession({ ...session, episodeId: event.target.value })}><option value="">No episode link</option>{live.episodes.filter((item) => !session.programmeId || item.programmeId === session.programmeId).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label style={styles.label}>Channel<select style={styles.input} value={session.channelId} onChange={(event) => setSession({ ...session, channelId: event.target.value })} required><option value="">Choose channel…</option>{live.channels.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label style={styles.label}>Automatic fallback audio<select style={styles.input} value={session.fallbackPromoVersionId} onChange={(event) => setSession({ ...session, fallbackPromoVersionId: event.target.value })} required><option value="">Choose approved audio…</option>{live.fallbackVersions.map((item) => <option key={item.id} value={item.id}>{item.promoAsset.name} · v{item.version}</option>)}</select></label><div style={styles.columns}><label style={styles.label}>Starts<input type="datetime-local" style={styles.input} value={session.scheduledStart} onChange={(event) => setSession({ ...session, scheduledStart: event.target.value })} required /></label><label style={styles.label}>Ends<input type="datetime-local" style={styles.input} value={session.scheduledEnd} onChange={(event) => setSession({ ...session, scheduledEnd: event.target.value })} required /></label></div><label style={styles.check}><input type="checkbox" checked={session.recordEnabled} onChange={(event) => setSession({ ...session, recordEnabled: event.target.checked })} /> Record the live session privately</label>{session.recordEnabled ? <label style={styles.check}><input type="checkbox" checked={session.retentionApproved} onChange={(event) => setSession({ ...session, retentionApproved: event.target.checked })} /> Retention approval is recorded</label> : null}<button style={styles.primary} disabled={working || !live.permissions.canSupervise}>Create supervised session</button></form>
      <aside style={styles.card}><p style={styles.eyebrow}>SAFETY CONTROLS</p><h3>Teacher remains in control</h3><p style={styles.muted}>A teacher approves the soundcheck, starts the broadcast, can force fallback, and records an audit reason when ending it.</p><p style={styles.warning}>Ruvanas school messages are not a certified fire or emergency alarm replacement.</p></aside>
    </div>
    <div style={styles.list}>{live.sessions.map((item) => <article key={item.id} style={styles.card}><div style={styles.row}><div><h3 style={styles.itemTitle}>{item.title}</h3><p style={styles.muted}>{item.programme.title} · {item.channel.name} · {new Date(item.scheduledStart).toLocaleString()}</p></div><div style={styles.actions}><Badge value={item.status} /><Badge value={item.connectionQuality} /></div></div><p style={styles.muted}>Fallback: {item.fallbackPromoVersion.promoAsset.name} · recording {item.recordEnabled ? "enabled with retention approval" : "off"}</p>{devices.length ? <label style={styles.label}>Microphone<select style={styles.input} value={deviceId} onChange={(event) => setDeviceId(event.target.value)}>{devices.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || "Microphone"}</option>)}</select></label> : null}<div style={styles.actions}>{new Set(["CREATED", "SOUNDCHECK", "ON_AIR"]).has(item.status) ? <button style={styles.primary} disabled={working} onClick={() => runSoundcheck(item)}>{item.status === "ON_AIR" ? "Check connection now" : "Run browser soundcheck"}</button> : null}{live.permissions.canSupervise && item.status === "SOUNDCHECK" ? <button style={styles.approve} disabled={working || item.connectionQuality !== "GOOD"} onClick={() => liveAction(item, "APPROVE_CONNECTION")}>Teacher approves connection</button> : null}{live.permissions.canSupervise && item.status === "READY" ? <button style={styles.approve} disabled={working} onClick={() => liveAction(item, "GO_LIVE")}>Go live</button> : null}{live.permissions.canSupervise && new Set(["SOUNDCHECK", "READY", "ON_AIR"]).has(item.status) ? <button style={styles.danger} disabled={working} onClick={() => liveAction(item, "FORCE_FALLBACK")}>Force fallback</button> : null}{live.permissions.canSupervise && item.status !== "ENDED" ? <button style={styles.secondary} disabled={working} onClick={() => liveAction(item, "END")}>End session</button> : null}</div></article>)}</div>
  </section>;
}

const styles = {
  shell: { margin: "0 0 24px", border: "1px solid #2b3a54", borderRadius: 16, background: "#121d30", padding: 22 },
  heading: { display: "flex", justifyContent: "space-between", gap: 18, alignItems: "flex-start", marginBottom: 18 },
  title: { margin: "0 0 8px", fontSize: 28 }, itemTitle: { margin: "0 0 5px" },
  eyebrow: { color: "#f4b942", fontSize: 12, fontWeight: 900, letterSpacing: 1.1, margin: "0 0 7px" },
  muted: { color: "#aebbd0", lineHeight: 1.5, margin: "6px 0" }, warning: { color: "#fed7aa", borderLeft: "3px solid #fb923c", paddingLeft: 10, lineHeight: 1.5 },
  columns: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 14 }, list: { display: "grid", gap: 14, marginTop: 14 },
  card: { border: "1px solid #34445f", borderRadius: 12, background: "#18243a", padding: 17 }, row: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  label: { display: "grid", gap: 6, marginBottom: 11, color: "#dce5f3", fontWeight: 800, fontSize: 13 }, check: { display: "flex", alignItems: "center", gap: 8, color: "#dce5f3", margin: "10px 0", fontWeight: 800, fontSize: 13 },
  input: { width: "100%", boxSizing: "border-box", border: "1px solid #61708a", borderRadius: 8, background: "#fff", color: "#111827", padding: "10px 11px", font: "inherit" }, textarea: { width: "100%", minHeight: 76, boxSizing: "border-box", border: "1px solid #61708a", borderRadius: 8, background: "#fff", color: "#111827", padding: 10, font: "inherit" }, editor: { width: "100%", minHeight: 130, boxSizing: "border-box", border: "1px solid #61708a", borderRadius: 8, background: "#fff", color: "#111827", padding: 10, fontFamily: "ui-monospace, monospace", fontSize: 12 },
  actions: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 10 }, primary: { border: 0, borderRadius: 8, background: "#f4b942", color: "#101827", padding: "10px 13px", fontWeight: 900, cursor: "pointer" }, approve: { border: 0, borderRadius: 8, background: "#22c55e", color: "#052e16", padding: "10px 13px", fontWeight: 900, cursor: "pointer" }, secondary: { border: "1px solid #94a3b8", borderRadius: 8, background: "transparent", color: "#e2e8f0", padding: "9px 12px", fontWeight: 800, cursor: "pointer" }, danger: { border: "1px solid #f87171", borderRadius: 8, background: "transparent", color: "#fecaca", padding: "9px 12px", fontWeight: 800, cursor: "pointer" },
  publicLink: { border: "1px solid #60a5fa", borderRadius: 8, color: "#bfdbfe", padding: "9px 12px", fontWeight: 800, textDecoration: "none" }, audit: { color: "#93a4bb", fontSize: 12, margin: "12px 0 0" },
  badge: { display: "inline-block", borderRadius: 6, background: "#263550", color: "#f8d78a", padding: "5px 8px", fontSize: 11, fontWeight: 900, whiteSpace: "nowrap" }, divider: { height: 1, background: "#34445f", margin: "26px 0" },
  error: { border: "1px solid #ef4444", background: "#451a1a", color: "#fecaca", borderRadius: 8, padding: 12, marginBottom: 14 }, notice: { border: "1px solid #22c55e", background: "#052e16", color: "#bbf7d0", borderRadius: 8, padding: 12, marginBottom: 14 }
};

