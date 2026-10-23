"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PLAYLIST_DESK_STATION_ID, emptyDeskRecipe, deskRecipeForm, deskRecipeSnapshot, deskRecipeCommand, deskLibrary,
  filterDeskRecipes, deskDuration, deskPreview, deskRecipeProgramme } from "@/lib/test-radio-playlist-desk-ui.mjs";
import styles from "./test-radio-planner.module.css";

export function TestRadioPlaylistPreview({ preview, name }) {
  if (!preview) return <div className={styles.empty}><strong>Your next programme starts here.</strong>Choose genres in Template Builder, or load a saved playlist. Then select Generate Playlist to see an example using your approved catalogue songs.</div>;
  return <>
    <div className={styles.metrics}>
      <div className={styles.metric}><span className={styles.meta}>Target length</span><strong>{deskDuration(preview.requestedDurationSeconds)}</strong></div>
      <div className={styles.metric}><span className={styles.meta}>Example length</span><strong>{deskDuration(preview.totalDurationSeconds)}</strong></div>
      <div className={styles.metric}><span className={styles.meta}>Preview entries</span><strong>{preview.items.length}</strong></div>
    </div>
    <p className={styles.hint}><strong>Example rotation, not the live queue.</strong> Your saved genre recipe guides the broadcast; the actual song order may differ. Times below are relative preview offsets, not on-air start times.</p>
    {preview.warnings.map((warning, index) => <p className={styles.notice} role="note" key={index}>{warning}</p>)}
    {preview.truncated && <p className={styles.notice}>This is a limited preview. It may not show the full requested length.</p>}
    {preview.items.length ? <div className={styles.tableWrap}><table className={styles.queue} aria-label={`Example rotation for ${name || "new playlist"}`}>
      <thead><tr><th scope="col">#</th><th scope="col">Song / artist</th><th scope="col" className={styles.elapsed}>Offset</th><th scope="col">Length</th></tr></thead>
      <tbody>{preview.items.map((item, index) => <tr key={`${item.trackId}:${index}`}><td>{item.position}</td><td><strong>{item.title}</strong><small>{item.artist}</small></td><td className={styles.elapsed}>{deskDuration(item.startSeconds)}</td><td>{deskDuration(item.durationSeconds)}</td></tr>)}</tbody>
    </table></div> : <div className={styles.empty}>No eligible songs were returned. Review the selected genres and library permissions.</div>}
    <p className={styles.hint} style={{ marginTop: 12 }}>Metadata preview only: no audio is played or downloaded. A scheduled programme cuts back to random AutoDJ at its approved end time.</p>
  </>;
}

export default function TestRadioPlaylistDesk({ stationId, onSourcesChanged, onAddToWeek, canAddToWeek = false }) {
  const [data, setData] = useState(null), [form, setForm] = useState(emptyDeskRecipe), [baseline, setBaseline] = useState(() => deskRecipeSnapshot(emptyDeskRecipe()));
  const [selectedId, setSelectedId] = useState(null), [search, setSearch] = useState(""), [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [message, setMessage] = useState("");
  const sequence = useRef(0), requestAbort = useRef(null), saving = useRef(false), saveAttempt = useRef(null);
  const searchInput = useRef(null), nameInput = useRef(null), sourcesChanged = useRef(onSourcesChanged);
  sourcesChanged.current = onSourcesChanged;
  const endpoint = `/api/admin/stations/${encodeURIComponent(stationId)}/continuous-playlists`;
  const dirty = deskRecipeSnapshot(form) !== baseline;
  const selected = data?.recipes?.find(recipe => recipe.sourceId === selectedId);
  const savedFormMatches = Boolean(selected && deskRecipeSnapshot(form) === deskRecipeSnapshot(deskRecipeForm(selected)));
  const canUse = canAddToWeek && savedFormMatches && Boolean(deskRecipeProgramme(selected));
  const recipes = useMemo(() => filterDeskRecipes(data?.recipes, search), [data, search]);
  const genreName = code => data?.genres?.find(genre => genre.code === code)?.name || code;

  const adoptLibrary = useCallback(body => {
    const library = deskLibrary(body);
    setData(library); sourcesChanged.current?.(library.recipes);
  }, []);
  const load = useCallback(async () => {
    if (stationId !== PLAYLIST_DESK_STATION_ID || saving.current) return;
    const id = ++sequence.current; requestAbort.current?.abort();
    const controller = new AbortController(); requestAbort.current = controller;
    const timer = setTimeout(() => controller.abort(), 20_000);
    setBusy("load"); setError("");
    try {
      const response = await fetch(endpoint, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The saved playlist library could not be loaded.");
      if (id === sequence.current) adoptLibrary(body);
    } catch (caught) { if (id === sequence.current) setError(caught.name === "AbortError" ? "Library loading timed out. Try Refresh library." : caught.message); }
    finally { clearTimeout(timer); if (id === sequence.current) setBusy(""); }
  }, [stationId, endpoint, adoptLibrary]);
  useEffect(() => { void load(); return () => { sequence.current += 1; requestAbort.current?.abort(); }; }, [load]);
  useEffect(() => {
    if (!dirty) return;
    const warn = event => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function change(next) { setForm(next); setPreview(null); setError(""); setMessage(""); saveAttempt.current = null; }
  function choose(recipe) {
    if (busy || dirty && !window.confirm("Discard your unsaved template changes and load this saved playlist? Your weekly draft will stay unchanged.")) return;
    const next = deskRecipeForm(recipe); setForm(next); setBaseline(deskRecipeSnapshot(next)); setSelectedId(recipe?.sourceId || null);
    setPreview(null); setError(""); saveAttempt.current = null;
    setMessage(recipe ? `Loaded “${recipe.name}”. The saved playlist is unchanged; Save as new playlist creates a separate copy.` : "New template. Nothing has been saved or added to your week.");
  }
  function toggleGenre(code) {
    const codes = form.genreCodes;
    change({ ...form, genreCodes: form.buildMode === "GENRE_SEQUENCE" ? [...codes, code] : codes.includes(code) ? codes.filter(value => value !== code) : [...codes, code] });
  }
  function moveGenre(index, direction) {
    const codes = [...form.genreCodes], target = index + direction;
    if (target < 0 || target >= codes.length) return;
    codes.splice(target, 0, codes.splice(index, 1)[0]); change({ ...form, genreCodes: codes });
  }
  async function command(action) {
    if (busy || saving.current || stationId !== PLAYLIST_DESK_STATION_ID) return;
    let body;
    const snapshot = deskRecipeSnapshot(form);
    try {
      if (action === "save" && (!saveAttempt.current || saveAttempt.current.snapshot !== snapshot)) saveAttempt.current = { snapshot, requestId: crypto.randomUUID() };
      body = deskRecipeCommand(form, { action, requestId: saveAttempt.current?.requestId, genres: data?.genres });
    } catch (caught) { setError(caught.message); return; }
    saving.current = true; const id = ++sequence.current; requestAbort.current?.abort();
    const controller = new AbortController(); requestAbort.current = controller;
    const timer = setTimeout(() => controller.abort(), 20_000);
    setBusy(action); setError(""); setMessage("");
    try {
      const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The playlist request could not be confirmed.");
      if (id !== sequence.current) return;
      if (action === "preview") { setPreview(deskPreview(result)); setMessage("Example rotation generated. Your live stream and approved week are unchanged."); }
      else {
        const saved = result.recipes?.find(recipe => recipe.sourceId === result.savedSourceId);
        if (result.stationId !== PLAYLIST_DESK_STATION_ID || !saved) throw new Error("The save result is uncertain. Retry unchanged to recover the same new playlist.");
        adoptLibrary(result); setForm(deskRecipeForm(saved)); setBaseline(deskRecipeSnapshot(deskRecipeForm(saved))); setSelectedId(saved.sourceId);
        saveAttempt.current = null; setMessage(`Saved “${saved.name}” as a new playlist. Add it to your weekly draft when ready; no on-air change was made.`);
      }
    } catch (caught) {
      if (id === sequence.current) setError(caught.name === "AbortError" ? (action === "save" ? "Saving timed out; the result is uncertain. Retry Save without changing the template to recover the same playlist." : "The preview timed out. Generate it again.") : caught.message);
    } finally { clearTimeout(timer); saving.current = false; if (id === sequence.current) setBusy(""); }
  }
  if (stationId !== PLAYLIST_DESK_STATION_ID) return null;
  return <section aria-labelledby="playlist-desk-title">
    <div className={styles.toolbar}>
      <h3 id="playlist-desk-title">Build your programme</h3>
      <button type="button" className={styles.primary} disabled={Boolean(busy) || !data} onClick={() => command("preview")}>{busy === "preview" ? "Generating…" : "Generate Playlist"}</button>
      <button type="button" disabled={Boolean(busy)} onClick={() => searchInput.current?.focus()}>Load Playlist</button>
      <button type="button" disabled={Boolean(busy)} onClick={() => nameInput.current?.focus()}>Template Builder</button>
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {message && <p className={styles.success} role="status">{message}</p>}
    {(data?.warnings || []).map((warning, index) => <p className={styles.notice} key={index}>{warning}</p>)}
    <div className={styles.desk}>
      <section className={`${styles.area} ${styles.libraryArea}`} aria-labelledby="desk-library-title">
        <div className={styles.areaHead}><p className={styles.sectionLabel}>01 · Saved library</p><h3 id="desk-library-title">Your playlists</h3><p className={styles.meta}>{data ? `${data.recipes.length} saved genre recipes` : "Loading saved playlists…"}</p></div>
        <div className={styles.areaBody}>
          <label>Find a playlist<input type="search" ref={searchInput} value={search} onChange={event => setSearch(event.target.value)} placeholder="Name or genre" /></label>
          <div className={styles.toolbar} style={{ margin: "10px 0 0" }}><button type="button" disabled={Boolean(busy)} onClick={() => choose(null)}>+ New</button><button type="button" className={styles.quiet} disabled={Boolean(busy)} onClick={load}>Refresh library</button></div>
          <div className={styles.libraryList}>{recipes.length ? recipes.map(recipe => <article key={recipe.sourceId} className={styles.recipe} data-selected={recipe.sourceId === selectedId}>
            <h4>{recipe.name}</h4><p className={styles.meta}>{recipe.buildMode === "GENRE_SEQUENCE" ? "Genre Sequence" : "Random Genre Mix"} · {recipe.durationMinutes} min</p>
            <p className={styles.meta}>{recipe.genreCodes.map(genreName).join(recipe.buildMode === "GENRE_SEQUENCE" ? " → " : " · ")}</p>
            <span className={styles.tag}>{recipe.eligibleTrackCount} eligible songs{recipe.readyForSchedule ? " · ready to plan" : " · needs review"}</span>
            <button type="button" disabled={Boolean(busy)} onClick={() => choose(recipe)} aria-label={`Load playlist ${recipe.name}`}>{recipe.sourceId === selectedId ? "Loaded playlist" : "Load playlist"}</button>
          </article>) : <p className={styles.empty}>{search ? "No saved playlists match your search." : data ? "Save your first genre recipe using Template Builder." : "Loading…"}</p>}</div>
        </div>
      </section>
      <section className={`${styles.area} ${styles.previewArea}`} aria-labelledby="desk-preview-title">
        <div className={styles.areaHead}><p className={styles.sectionLabel}>02 · Prepare, don’t broadcast</p><h3 id="desk-preview-title">{form.name || "New playlist preview"}</h3><p className={styles.meta}>{dirty ? "Unsaved template changes" : selected ? "Loaded saved recipe" : "Choose a template or saved playlist"}</p></div>
        <div className={styles.areaBody}>
          <TestRadioPlaylistPreview preview={preview} name={form.name} />
          <div className={styles.builderActions}>
            <button type="button" className={styles.primary} disabled={Boolean(busy) || !canUse} onClick={() => { onAddToWeek?.(selected); setMessage(`Added “${selected.name}” to your unsaved weekly draft. Choose its day and time below, then save and review.`); }}>Add saved playlist to week ↓</button>
            <p className={styles.hint}>{!savedFormMatches ? "Save this template as a new playlist, or load an unchanged saved playlist, before adding it to your week." : !selected?.readyForSchedule ? "This recipe needs eligible music within the scheduled-playlist limit before it can be added." : !deskRecipeProgramme(selected) ? "This older playlist has a longer saved length. Choose 1–180 minutes and Save as new playlist to prepare a shorter copy; the original stays unchanged." : "Adds a draft programme only. Your current approved week and stream stay unchanged."}</p>
          </div>
        </div>
      </section>
      <section className={`${styles.area} ${styles.builderArea}`} aria-labelledby="desk-builder-title">
        <div className={styles.areaHead}><p className={styles.sectionLabel}>03 · Reusable recipe</p><h3 id="desk-builder-title">Template Builder</h3><p className={styles.meta}>Choose how your music is selected.</p></div>
        <div className={styles.areaBody}>
          <fieldset disabled={Boolean(busy) || !data} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} className={styles.formStack}>
            <label>Playlist name<input ref={nameInput} maxLength={120} value={form.name} onChange={event => change({ ...form, name: event.target.value })} placeholder="e.g. Morning energy" /></label>
            <div className={styles.twoFields}>
              <label>Length (minutes)<input type="number" min="1" max="180" value={form.durationMinutes} onChange={event => change({ ...form, durationMinutes: event.target.value })} /></label>
              <label>Selection method<select value={form.buildMode} onChange={event => change({ ...form, buildMode: event.target.value, genreCodes: event.target.value === "RANDOM_GENRE_POOL" ? [...new Set(form.genreCodes)] : form.genreCodes })}><option value="RANDOM_GENRE_POOL">Random Genre Mix</option><option value="GENRE_SEQUENCE">Genre Sequence</option></select></label>
            </div>
            <div><p className={styles.hint}>{form.buildMode === "GENRE_SEQUENCE" ? "Add genre slots in order. The pattern repeats; a matching song is chosen for each slot." : "Select genres to mix together. Songs are chosen randomly from eligible recordings."}</p>
              <div className={styles.genreChoices} role="group" aria-label="Available music genres">{(data?.genres || []).map(genre => <button type="button" key={genre.code} aria-pressed={form.buildMode === "RANDOM_GENRE_POOL" ? form.genreCodes.includes(genre.code) : undefined} disabled={form.genreCodes.length >= 48 && (form.buildMode === "GENRE_SEQUENCE" || !form.genreCodes.includes(genre.code))} onClick={() => toggleGenre(genre.code)}>{form.buildMode === "GENRE_SEQUENCE" ? "+ " : ""}{genre.name} <span className={styles.meta}>({genre.eligibleTrackCount})</span></button>)}</div>
              {!data?.genres?.length && <p className={styles.hint}>No eligible genres are available in this snapshot.</p>}
            </div>
            {form.buildMode === "GENRE_SEQUENCE" && <ol className={styles.pattern} aria-label="Genre sequence">{form.genreCodes.map((code, index) => <li key={`${code}:${index}`}><span>{index + 1}. {genreName(code)}</span><button type="button" aria-label={`Move genre slot ${index + 1} up`} disabled={index === 0} onClick={() => moveGenre(index, -1)}>↑</button><button type="button" aria-label={`Move genre slot ${index + 1} down`} disabled={index === form.genreCodes.length - 1} onClick={() => moveGenre(index, 1)}>↓</button><button type="button" disabled={form.genreCodes.length >= 48} aria-label={`Duplicate genre slot ${index + 1}`} onClick={() => change({ ...form, genreCodes: form.genreCodes.flatMap((value, position) => position === index ? [value, value] : [value]) })}>Copy</button><button type="button" aria-label={`Remove genre slot ${index + 1}`} onClick={() => change({ ...form, genreCodes: form.genreCodes.filter((_, position) => position !== index) })}>×</button></li>)}</ol>}
          </fieldset>
          <div className={styles.builderActions}>
            <button type="button" className={styles.primary} disabled={Boolean(busy) || !data} onClick={() => command("save")}>{busy === "save" ? "Saving new playlist…" : "Save as new playlist"}</button>
            <p className={styles.hint}>Creates a new saved recipe. It never overwrites a loaded playlist, starts audio or changes an approved week.</p>
            <p className={styles.meta}>Up to {data?.limits?.maximumRecipeTracks || 64} eligible recordings per scheduled recipe · {data?.limits?.maximumDurationMinutes || 180} minutes per new template.</p>
          </div>
        </div>
      </section>
    </div>
  </section>;
}
