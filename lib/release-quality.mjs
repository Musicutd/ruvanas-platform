const conflictMarker = /^\s*(?:<{7}|={7}|>{7}|\|{7})(?:\s|$)/;

export function inspectRepositoryText(path, text) {
  const findings = [];
  if (text.includes("\0")) findings.push({ path, line: 1, code: "NUL_BYTE" });

  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (conflictMarker.test(line)) findings.push({ path, line: index + 1, code: "MERGE_CONFLICT_MARKER" });
    if (/[ \t]+$/.test(line)) findings.push({ path, line: index + 1, code: "TRAILING_WHITESPACE" });
  }

  if (text.length > 0 && !text.endsWith("\n")) findings.push({ path, line: lines.length, code: "MISSING_FINAL_NEWLINE" });
  return findings;
}

export function validateMediaToolVersion(name, output) {
  const firstLine = String(output || "").split(/\r?\n/, 1)[0].trim();
  if (!firstLine || !new RegExp(`^${name} version\\s`, "i").test(firstLine)) {
    throw new Error(`${name} did not return a recognised version string.`);
  }
  return firstLine;
}

export function acceptableRedirect(status, location) {
  return [302, 303, 307, 308].includes(status) && /^\/login(?:[?#]|$)/.test(location || "");
}
