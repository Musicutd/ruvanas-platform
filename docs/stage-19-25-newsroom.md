# Stage 19.25 — Professional Newsroom

## Outcome

Stage 19.25 gives Online Radio organisations a professional assignment desk from pitch to controlled newsroom release. It generalises the proven School Radio story workflow with a product discriminator, shared transition rules and shared immutable editorial evidence. It does not create a second editor or weaken School safeguarding.

## Subscriber journey

1. An owner, manager or content editor pitches a station-owned story and optionally targets a channel.
2. An owner or manager assigns the pitch to an active newsroom team member.
3. The assigned editor writes the script, records structured sources and fact-check notes, and saves immutable revisions.
4. The editor attaches a Ruvanas Studio project or approved organisation-owned interview recording.
5. The story moves through scripting, fact-check, audio production and review with explicit transition checks.
6. An owner or manager approves, requests changes with mandatory feedback, and releases the approved story.

## Editorial controls

- Active organisation and Online Radio entitlement are derived from the authenticated session.
- All station, channel, member, Studio and media selections are verified against the active organisation.
- Composite database keys protect station/channel/story and Studio/story ownership relationships.
- Content editors may work only on unassigned stories or stories assigned to them. Owners and managers retain editorial oversight.
- Source lists are bounded, normalised, de-duplicated and fingerprinted in the audit evidence.
- Fact-checking requires a script and at least one source. Audio production requires fact-check notes. Review requires a ready Studio project or ready interview recording.
- Interview stories cannot be approved without a recorded consent confirmation.
- Every save creates an immutable `NewsStoryRevision`; every transition creates an immutable `NewsStoryDecision` and organisation audit entry.

## Publication boundary

`PUBLISH` means the story has been released by the internal newsroom. Stage 19.25 does not insert content into a schedule, alter the shared playout resolver, publish a public station page or distribute content to an external provider. Scheduling and public distribution remain separate, deliberate workflows.

## School Radio compatibility

Existing rows default to `SCHOOL_RADIO`. The School newsroom route explicitly filters and creates only School rows and continues to require the School entitlement and safeguarding access layer. Online Radio uses `ONLINE_RADIO`; neither route can read or mutate the other product's stories. The existing database table and Prisma model name are retained as a compatibility adapter while the shared newsroom core lives in `lib/newsroom.mjs`.

## Migration and rollback

The migration is additive: product, station, channel, Studio and publication fields are added to existing stories; new revision and decision tables preserve history. Rollback should first archive or retain Online Radio stories, remove application access, and preserve editorial evidence. Dropping the new columns, enum or evidence tables requires a separate retention review.

## Verification matrix

- Unit tests cover source normalisation, duplicate removal, role/assignment policy and Online Radio transition gates.
- Static route tests cover active-tenant derivation, product isolation, composite ownership, revision/decision evidence, manager release and the no-live-change boundary.
- Regression tests preserve the School newsroom entitlement and explicit `SCHOOL_RADIO` filter.
- Prisma validation, migration checks, the complete automated test suite and the production build remain mandatory before publication.
