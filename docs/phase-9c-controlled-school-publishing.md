# Stage 9C — Controlled School Publishing

Stage 9C adds a guarded public School Radio release path while preserving the platform's private-by-default safeguarding boundary. It does not grant publishing authority to students.

## Independent controls

Public publishing is available only when all of these controls remain valid:

1. A Ruvanas Super Admin has enabled the separate controlled-publishing capability for the organisation.
2. The school's publishing policy is explicitly set to `PUBLIC` by an organisation owner or manager, with an audit reason.
3. The school's safeguarding readiness remains approved.
4. The episode and its audio master are staff-approved.
5. A staff reviewer has explicitly approved the transcript.
6. Every assigned student contributor has a current, unrevoked consent record.

Internal publishing remains available through the existing staff workflow and does not turn on the public school page.

## Public privacy boundary

The public page and metadata endpoint return only the school display name, approved episode metadata, chapters, transcript text, dates, and an audio route that revalidates policy before each request. They do not expose:

- contributor identities or internal contributor references;
- transcript speaker labels;
- consent records or evidence;
- staff identities, reviewer notes, or audit records;
- private episode, submission, promo, media, or storage identifiers; or
- direct storage locations.

## Continuous revalidation and withdrawal

Public metadata and audio are revalidated at request time. Published material is immediately moved to `UNPUBLISHED` when:

- the controlled-publishing capability is disabled;
- the school returns its policy to private;
- safeguarding approval changes to `CHANGES_REQUESTED`;
- relevant contributor consent is revoked; or
- public editor content is changed and requires fresh transcript review.

Manual unpublishing requires a reason. Every publish, unpublish, and automatic withdrawal creates an immutable `SchoolPublicationDecision` with the policy version and a control snapshot.

## Deliberate exclusions

- Guarded student accounts remain read-only and cannot approve or publish.
- Automated moderation may assist future review but never silently approves or rejects content.
- Unlisted and parent-community delivery remain future policy modes; Stage 9C enables only private and controlled public publishing.
