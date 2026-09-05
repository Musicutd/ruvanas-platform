# Stage 19.12 — Broadcast Audio Processing

## Outcome

Stage 19.12 adds organisation-owned broadcast processing profiles to the existing protected Ruvanas audio worker. A completed AudioLab or multitrack render can be converted into a measured web-radio, talk-radio or archive output without changing its immutable project version or creating another upload, storage, queue or worker system.

## Subscriber workflow

1. An organisation owner or manager starts from Web Radio, Talk Radio or Archive Master settings, or enters bounded custom values.
2. The profile remains a draft until an owner or manager activates it.
3. An owner, manager or content editor chooses a completed source render and an active profile.
4. Ruvanas snapshots the exact profile revision and creates one duplicate-safe processing request.
5. The existing audio worker downloads the protected project sources, applies the profile and writes to a deterministic protected output key.
6. Loudness, true peak and loudness range are measured from the encoded result.
7. The output receives an explicit `PASSED` or `FAILED` quality result and remains reviewable through protected playback.

No processing request changes live programming automatically. Existing AudioLab review, promo approval, Radio Clock and playout controls remain authoritative.

## Processing contract

Profiles control:

- MP3, AAC or 24-bit WAV output;
- 44.1 kHz or 48 kHz sample rate;
- bounded encoded bitrate;
- integrated loudness target;
- true-peak ceiling;
- maximum loudness range;
- high-pass and low-pass filtering;
- compressor threshold, ratio, attack and release;
- an optional final safety limiter.

The worker builds one deterministic FFmpeg filter graph. When a broadcast profile is present, it replaces the editor's generic master normalisation so the audio is never normalised twice.

## Governance and tenancy

- Every profile, source render and output is resolved inside the active organisation.
- Owners and managers control profile creation, revision, activation and archival.
- Content editors may request processing but cannot activate technical profiles.
- A profile revision is snapshotted into each render request. Later profile edits cannot alter queued or completed outputs.
- The request key covers the organisation, immutable project version and complete profile snapshot. Concurrent duplicate requests converge on the same job.
- Audit entries retain the profile, revision, source and output workflow without exposing storage credentials.

## Worker safety and recovery

- Processing reuses `AudioRender`, the protected object store and `scripts/audio-worker.mjs`.
- Deterministic output keys make upload retries idempotent.
- A worker may reclaim a broadcast job that has been stale for fifteen minutes.
- After three protected attempts, a repeatedly interrupted job fails closed for operator review.
- A profile cannot be archived while its jobs are queued or running.
- Failed QC is reported separately from technical render completion; it is never represented as an approved broadcast output.

## Quality control

An output passes only when all three measured values are present and within the profile tolerances:

- integrated loudness within 1 LU of target;
- true peak no more than 0.2 dB above the ceiling;
- loudness range no more than 0.5 LU above the configured maximum.

The result stores bounded findings, profile identity and revision, duration and immutable-source evidence. Subscriber responses expose playable protected URLs and measured values, not object-storage keys.

## Rollback

Stop queuing new broadcast jobs and allow active jobs to finish. Archive profiles and retain their outputs for audit and recovery. Application rollback leaves the additive profile and render metadata dormant. Remove the database additions only after confirming that no retained `AudioRender` row references a broadcast profile.
