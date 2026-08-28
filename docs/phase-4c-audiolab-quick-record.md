# Stage 4C — AudioLab Quick Record

Stage 4C adds the first browser-based production tool to the private School Radio workspace. It extends the existing organisation, audio library, promo-version approval, episode submission, audit, and protected-streaming foundations.

## Staff workflow

1. Create an AudioLab project and optionally link it to a programme, draft episode, or student group.
2. Test microphone permission, select an input, watch the live peak meter, and record with pause, resume, stop, and duration controls.
3. Recover one-second recording chunks from local browser storage if the page or connection is interrupted.
4. Preview the local take and save trim, fade, normalization, loudness-target, and optional cleanup decisions without changing the source recording.
5. Upload in retryable 5 MB parts to protected quarantine storage.
6. Validate the completed object, promote it to protected organisation storage, and create a MediaAsset, AudioTake, PromoAsset, and reviewable PromoVersion.
7. Preview the protected take and submit it to a linked episode through the existing staff moderation workflow.

## Safety and integrity boundaries

- School Radio entitlement and organisation membership are required on every project and upload route.
- Upload sessions, projects, takes, and media records are organisation-scoped; upload sessions also belong to the initiating user.
- Recording formats and file signatures are validated independently. WebM/Opus, OGG/Opus, M4A, MP3, and WAV are accepted.
- The server caps Quick Record at 250 MB, uses 5 MB multipart parts, enforces subscription storage limits, and rejects incomplete or expired sessions.
- Source takes are immutable. Edit decisions live in the project and take records, with an immutable AudioProjectVersion snapshot for every autosave.
- Completed takes reuse the existing protected media stream and promo QC/approval jobs. No public URL or storage key is exposed.
- Public School Radio publishing remains disabled.

## Deliberately deferred

- Stage 4D: detailed waveform editing and region tools.
- Stage 4E: Show Builder assembly.
- Stage 4F: multitrack recording and mixing.
- Authoritative ffmpeg render workers will consume the stored edit decisions and existing queued processing jobs in their controlled processing milestone.

