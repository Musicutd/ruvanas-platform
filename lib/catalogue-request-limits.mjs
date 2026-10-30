const MIB = 1024 * 1024;

export const MAX_CATALOGUE_ARCHIVE_SIZE_BYTES = 150 * MIB;
export const MAX_CATALOGUE_MANIFEST_SIZE_BYTES = 10 * MIB;
export const MAX_CATALOGUE_BULK_REQUEST_BYTES = 165 * MIB;

const DEFAULT_POLICY = Object.freeze({ maxBytes: 10 * MIB, error: "This request exceeds the 10 MB request limit." });
const SINGLE_POLICY = Object.freeze({ maxBytes: 55 * MIB, error: "The single-track upload exceeds the 50 MB audio limit." });
const RETAIL_COMMERCIAL_POLICY = Object.freeze({ maxBytes: 21 * MIB,
  error: "The commercial upload exceeds the 20 MB audio limit. Choose a smaller recording." });
const BULK_POLICY = Object.freeze({ maxBytes: MAX_CATALOGUE_BULK_REQUEST_BYTES,
  error: "The batch exceeds the 165 MB total request limit. Use a ZIP up to 150 MB and a spreadsheet up to 10 MB." });

// Exact route names only: an upload allowance must not expand other APIs.
export function catalogueRequestSizePolicy(pathname, method = "POST") {
  if (pathname === "/api/programming/test-retail/commercial-audio" && method === "POST") return RETAIL_COMMERCIAL_POLICY;
  if (pathname === "/api/admin/catalogue/bulk-upload" && method === "POST") return BULK_POLICY;
  if (pathname === "/api/admin/catalogue/upload") return SINGLE_POLICY;
  return DEFAULT_POLICY;
}

// Browser-safe preflight, also enforced before server-side file buffer reads.
export function catalogueBulkFileSizeError(archive, manifest) {
  if (archive?.size > MAX_CATALOGUE_ARCHIVE_SIZE_BYTES) return "The ZIP file exceeds the 150 MB batch limit.";
  if (manifest?.size > MAX_CATALOGUE_MANIFEST_SIZE_BYTES) return "The catalogue spreadsheet exceeds the 10 MB limit.";
  return null;
}
