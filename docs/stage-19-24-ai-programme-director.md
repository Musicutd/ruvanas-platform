# Stage 19.24 — Governed AI Programme Director

## Purpose

Stage 19.24 gives Online Radio subscribers an explainable programme-planning assistant without giving software autonomous control of their live station. The first engine is a deterministic Ruvanas rules provider: it evaluates the organisation's approved scheduling metadata, retains existing programme items and proposes a low-priority continuity layer from an eligible Music Mode.

No external AI provider is called in this stage. The workflow does not send listener identity, student data, raw audio, credentials or private stream information outside Ruvanas.

## Controlled workflow

1. An owner, manager or content editor chooses an active channel, an eligible continuity Music Mode and a bounded programming objective.
2. Ruvanas captures the current schedule version, builds a draft plan and records provider, policy, input, evidence and data-handling provenance.
3. An owner or manager edits and explicitly approves or rejects the recommendation. Approval remains an internal decision and changes no schedule.
4. A second explicit owner/manager action may apply the approved plan. This creates a new `DRAFT` Programme Schedule version only.
5. Preview, conflict acknowledgement and publication continue through the existing Advanced Scheduler. The Programme Director has no publish operation.

If the underlying schedule changes after a recommendation is created, draft application fails closed and the user must request a fresh recommendation.

## Recommendation policy

- The local engine adds full-day, priority-zero continuity only for weekdays without existing full-day cover.
- Existing schedule items are retained and assigned a higher draft priority so programmes remain preferred over the continuity bed.
- The result stays within the existing 200-item Advanced Scheduler limit.
- Only active channels and active, Online-Radio-eligible Music Modes may be used.
- Requests are limited to 20 recommendations per organisation in a rolling 24-hour window.
- Objectives label the review intent; they do not make unsupported audience or commercial claims.

## Roles and tenancy

- `OWNER`, `MANAGER` and `CONTENT_EDITOR` may request a recommendation.
- Only `OWNER` and `MANAGER` may approve, reject or apply it to a schedule draft.
- All jobs, channels, schedules, sources, feedback and audit evidence are scoped to the active organisation.
- A stale recommendation cannot overwrite or silently replace newer human scheduling work.

## Evidence and audit

Every recommendation stores the baseline schedule/version, item counts, continuity additions, objective, policy version, local provider identity and explicit `autoPublishAllowed: false` provenance. Creation, review and draft application create separate audit events. Applying a recommendation records the new schedule version and confirms that the live schedule was not changed.

## Migration and rollback

The database migration adds `PROGRAMME_DIRECTOR` to the existing AI assistant type. Recommendation plans remain in the existing governed `AIJob`, `AIArtifactMetadata` and `RecommendationFeedback` records; no duplicate AI governance store is introduced.

Rollback begins by removing the subscriber route and workspace. Existing Programme Schedule drafts created from approved recommendations remain ordinary human-owned drafts and should be reviewed or archived through Programming. The enum value should only be removed after associated AI job records have been retained or migrated according to policy.

## Verification matrix

- Unit: request bounds, role separation, continuity planning, priority preservation and provenance.
- Integration: governed AI job creation, owner/manager review and draft-only schedule application.
- Security: tenant-scoped sources, stale-baseline rejection, daily limit and no external/private-data path.
- Regression: Advanced Scheduler remains the sole publication boundary; Retail Radio and School Radio shared controls remain unchanged.
- Production: full test suite, static checks, Prisma validation and production build before publication.
