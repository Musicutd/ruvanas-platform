# Stage 16D — First-Use Onboarding and Contextual Help

Stage 16D gives new subscribers a clear path from an empty account to verified shop playback. It uses existing organisation, station, programme, player and stream evidence; it does not introduce a second editable checklist or allow presentation state to override operational truth.

## First-use setup guide

- The subscriber home shows five ordered steps: station, listening location, music programme, shop player and live playback.
- Each step states whether it belongs to the subscriber, an owner or manager, Ruvanas-managed setup, or live evidence.
- The first incomplete step supplies the main dashboard action so the large recommendation and the checklist cannot disagree.
- Completed configuration is derived from an active station, active location, active music mode, published schedule, configured player and active stream lease.
- The guide uses a native disclosure control. A subscriber can hide it and reopen it without recording personal behaviour or creating a new server-side preference.
- Once every step is complete, the guide becomes a compact readiness summary and the main action opens live stream monitoring.

## Contextual help

- Dashboard help explains the division between subscriber work, Ruvanas-managed setup and evidence-based completion.
- Station creation explains what the basic identity controls and what follows.
- Streaming setup explains where provider details normally come from and reinforces private password handling.
- Shop-player help explains the one-device rule, safe enrolment-code use and readiness evidence.
- Media-upload help distinguishes subscriber promotional audio from the Ruvanas-managed music catalogue and explains review before use.
- Help remains collapsed until requested so experienced operators keep direct access to the full controls.

## Access and operational boundaries

- Existing page and API permissions remain authoritative.
- View-only members are not described as able to perform owner or manager actions.
- No database migration, customer-data rewrite, subscription change, audio-engine change or new tracking is introduced.
- No secrets or provider credentials are exposed by onboarding.
- The free staging service remains outside this work.

## Accessibility and verification

- Native details and summary elements provide keyboard show/hide behaviour without custom event handling.
- Current steps use `aria-current`, actions retain visible focus, and the five-column guide becomes two columns and then one column on smaller screens.
- Automated coverage verifies ordering, evidence rules, completed setup, disabled-service handling, view-only language, semantic disclosure controls and responsive focus behaviour.
- Release verification also includes the full regression suite, static-integrity checks and a production build.

## Next usability increment

Stage 16E should run controlled end-to-end usability checks for owner, manager and viewer journeys, add a lightweight help index for recurring questions, and close any remaining responsive or accessibility gaps before the usability programme is signed off.
