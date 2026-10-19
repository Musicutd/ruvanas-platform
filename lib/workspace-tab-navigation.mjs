export function workspaceTabFromHash(hash, tabIds, defaultId) {
  if (!hash) return tabIds.includes(defaultId) ? defaultId : null;
  if (!/^#workspace-[a-z0-9-]+$/.test(hash)) return null;
  const requested = hash.slice("#workspace-".length);
  return tabIds.includes(requested) ? requested : null;
}
