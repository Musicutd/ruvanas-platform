export const MAX_CORRECTIONS_RECORDING_BYTES = 50 * 1024 * 1024;

export function requestBodyLimitBytes(pathname) {
  if (pathname === "/api/admin/catalogue/upload") return 55 * 1024 * 1024;
  if (pathname === "/api/corrections/contributor/recordings") return MAX_CORRECTIONS_RECORDING_BYTES + 1024 * 1024;
  return 10 * 1024 * 1024;
}
