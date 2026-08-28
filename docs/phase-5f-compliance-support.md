# Stage 5F — Compliance evidence and support operations

Stage 5F adds controlled evidence and case-management workflows around the existing tenant, security, catalogue, playback, and school-radio foundations.

## Delivered

- Versioned policy definitions and organisation/user acceptance evidence.
- Rights-evidence summaries based on the existing catalogue rights holder, reference, territory, confirmation, and licence-expiry fields.
- Privacy data-request tracking for export, correction, deletion, and restriction requests.
- Organisation-specific retention policies with bounded safety limits.
- No-delete retention previews that record cutoffs and candidate counts without changing customer data.
- Support and incident tickets linked to an organisation and optional operational entity reference.
- Tenant-scoped audit CSV exports with secret-field redaction and spreadsheet-formula neutralisation.
- SHA-256 export content hashes and a per-organisation chained seal so later changes to an exported file or the export sequence can be detected.
- Super Admin compliance controls and shared Super Admin/Support ticket controls at `/admin/compliance`.

## Safety and claims boundary

- Retention jobs created by this stage are always dry runs. They cannot delete records.
- A deletion privacy request is a tracked workflow; creating or approving it does not erase data.
- Audit exports are tamper-evident, not legally immutable. The source `AuditLog` remains an operational database table.
- The software assists evidence collection but does not create regulatory certification or legal compliance by itself.
- Jurisdiction, contract, licensing, tax, retention, and public-safety requirements still require business and legal approval before launch.

## Audit export controls

- Exports are limited to one organisation and a maximum 366-day window.
- Only a signed-in Ruvanas Super Admin who requested the export can download it.
- Download links expire after 24 hours and are HMAC signed.
- Secret-like detail keys are redacted recursively before CSV generation.
- Each export stores its content SHA-256 and a seal derived from the previous organisation export seal, scope, time window, and row count.

## Deferred deliberately

- Destructive retention execution and deletion approval workflows.
- External write-once or object-lock storage for audit archives.
- Jurisdiction-specific policy packs and automated statutory deadlines.
- Customer-facing self-service privacy request submission.
- External support integrations, paging, and service-level agreement automation.

