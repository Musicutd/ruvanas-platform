const FIELDS = Object.freeze(["title", "artist", "album", "mixName", "bpm", "releaseYear", "durationSeconds"]);

export function applyCatalogueMetadataAutofill(form, metadata) {
  if (!form || !metadata || typeof metadata.title !== "string" || typeof metadata.artist !== "string" ||
      typeof metadata.isExplicit !== "boolean" || !Array.isArray(metadata.genreIds) ||
      metadata.genreIds.some((value) => typeof value !== "string") || !Array.isArray(metadata.newGenreNames)) {
    throw new Error("The spreadsheet response was incomplete. Please try matching it again.");
  }
  const controls = FIELDS.map((name) => [name, form.elements.namedItem(name)]);
  const explicit = form.elements.namedItem("isExplicit");
  if (controls.some(([, control]) => !control) || !explicit) {
    throw new Error("The upload form changed. Refresh the page and match the spreadsheet again.");
  }
  const snapshot = { values: {}, isExplicit: metadata.isExplicit, genres: {} };
  for (const [name, control] of controls) {
    control.value = metadata[name] ?? "";
    snapshot.values[name] = String(control.value);
  }
  explicit.checked = metadata.isExplicit;
  for (const box of form.querySelectorAll('input[name="genreIds"]')) {
    box.checked = metadata.genreIds.includes(box.value);
    snapshot.genres[box.value] = box.checked;
  }
  return snapshot;
}

// A new file pair must not inherit the previous song's automatic details.
// Preserve manual edits, and never touch rights, territories, tiers or consent.
export function clearCatalogueMetadataAutofill(form, snapshot) {
  if (!form || !snapshot) return;
  for (const name of FIELDS) {
    const control = form.elements.namedItem(name);
    if (control && String(control.value) === snapshot.values[name]) control.value = "";
  }
  const explicit = form.elements.namedItem("isExplicit");
  if (explicit && explicit.checked === snapshot.isExplicit) explicit.checked = false;
  for (const box of form.querySelectorAll('input[name="genreIds"]')) {
    if (snapshot.genres[box.value] === true && box.checked) box.checked = false;
  }
}
