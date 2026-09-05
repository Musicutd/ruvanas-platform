# Stage 19.11 — Voice Tracking and Segue

## Outcome

Stage 19.11 adds a controlled Online Radio workflow for turning an approved voice link into a reusable three-part segue: outgoing song, voice link and incoming song. It reuses the current AudioLab, waveform editor, multitrack renderer, protected media delivery, rights engine and Radio Clocks. It does not create another recorder, media library, scheduler or playout engine.

## Operator journey

1. Produce the spoken link with the existing AudioLab or multitrack tools.
2. Complete the existing render, quality-control and manager-approval process.
3. Open **Voice Tracking + Segue** in Radio Programming.
4. Choose the destination channel, approved voice render, outgoing song and incoming song.
5. Set the outgoing cue, voice trim, incoming-song intro, overlaps and music ducking level.
6. Listen to the complete three-source preview. The browser starts close to the outgoing cue, brings in the trimmed voice, ducks the music, and starts the next song beneath the end of the link.
7. Save a draft. An owner or manager must play that saved version before **Approve for clocks** becomes available.
8. Use the approved voice track as a protected source in a Radio Clock. Saving or approving the voice track does not silently alter a live clock.

## Data and access boundaries

- Every segue is owned by one organisation and one active channel. The composite channel relationship prevents cross-tenant binding.
- The voice source must be a successful render whose promo version belongs to the same organisation and is approved, quality-checked and backed by ready protected media.
- Both songs must pass the shared Online Radio music-rights eligibility check at save and again when a clock is published.
- Owners, managers and content editors may create and edit drafts. Only owners and managers may approve or archive them.
- Version numbers and conditional writes prevent a stale browser from overwriting newer timing or approval decisions.
- API responses expose protected streaming routes, never storage keys, tenant identifiers or render internals.

## Cue and preview rules

- All cue values are stored in integer milliseconds.
- Voice trim must remain inside the approved rendered asset and retain at least one millisecond.
- The outgoing cue cannot exceed that song's known duration.
- The incoming intro cue cannot exceed the incoming song's known duration.
- Each overlap is limited to 30 seconds and cannot exceed the relevant cue or trimmed voice duration.
- Ducking is limited to −36 dB through 0 dB.
- Database constraints mirror the durable numeric bounds; application validation applies the source-duration bounds.
- The audible preview uses the browser Web Audio graph only for review. Authoritative sources remain protected and unchanged.

## Radio Clock integration

`VOICE_TRACK` is a first-class Radio Clock item type. It stores a relationship to the approved segue instead of copying media or timing metadata. Clock publication rechecks the segue status, render status, voice QC and protected source readiness. The clock continues to use the existing exact-hour and transition rules.

## Rollback

Archive affected voice-track segues and remove their items from unpublished Radio Clock drafts before reversing the migration. Do not reverse the migration while a saved clock references a segue. AudioLab projects, renders, promo versions and music tracks are shared assets and must not be deleted as part of Stage 19.11 rollback.
