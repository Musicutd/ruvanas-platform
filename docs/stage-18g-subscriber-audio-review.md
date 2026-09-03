# Stage 18G — Subscriber Audio Review Journey

Stage 18G turns the subscriber Media library into a controlled, understandable route from upload to scheduling.

## Subscriber journey

1. Upload an announcement, jingle, voiceover or commercial as a private draft.
2. Preview the exact stored version through the protected media endpoint.
3. Submit the draft for review as an organisation owner, manager or content editor.
4. Follow a plain-language status while Ruvanas completes quality and rights review.
5. Upload a new immutable version when changes are requested.
6. Open an approved version directly in the Promotions Planner.

## Controls

- Every library query is limited to the session's active organisation.
- Subscriber viewers are read-only.
- Subscriber roles cannot approve their own audio.
- Final approve/reject actions require a Ruvanas platform administrator.
- Version submission uses an atomic draft-only transition to prevent duplicate actions.
- Upload, submission and review decisions remain in the audit trail.
- Rejected versions remain immutable and carry the review note into the replacement workflow.

## Compatibility

- Existing approved and in-review versions remain valid.
- New direct subscriber uploads begin in `DRAFT` instead of being submitted automatically.
- No database migration or new environment setting is required.
