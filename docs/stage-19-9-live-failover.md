# Stage 19.9 — Health-Driven Live Failover

## Outcome

Stage 19.9 keeps an Online Radio channel on air when an External Live source becomes unhealthy. An organisation owner or manager can protect a channel with one primary source, an optional backup source, bounded failure and recovery thresholds, and a recovery hold. The policy feeds the existing Stage 19.6 Unified Playout Engine; it does not create another scheduler, player or streaming path.

## On-air decision order

1. A recently healthy, time-bounded manual override is authoritative until its maximum four-hour window ends or a manager clears it.
2. A stable primary source carries External Live.
3. A confirmed primary failure selects the healthy backup.
4. If no protected source is healthy, the External Live candidate fails closed and the Unified Playout Engine selects published scheduled programming or Continuous AutoDJ.
5. A recovered primary must pass the configured number of health checks and remain healthy for the recovery hold before it returns on air.

The temporary scheduled-programming state on an initial failed probe is deliberate: uncertain live audio is never preferred simply to satisfy a failure counter.

## Health and evidence

- The existing operations worker probes the primary, backup and current manual source every 30 seconds.
- Source credentials remain encrypted and never enter policy evidence, notifications or player manifests.
- Meaningful transitions create immutable `LiveFailoverEvent` rows containing source IDs, thresholds, health classifications and a monotonic transition version.
- Failover to backup or shared programming creates a governed stream notification. Stable primary recovery creates an informational recovery notification.
- The subscriber programming workspace shows current state, effective source, thresholds and recent transition evidence.

## Manager controls

Only organisation owners and managers can configure, disable or override a policy. Configuration is tenant- and channel-bound. A policy can only be enabled when its selected sources are ready, recently tested and healthy. Manual overrides can select only a healthy ready source on that policy's channel, last between 5 minutes and 4 hours, and automatically return to health-driven control.

DJ grants do not grant failover-policy authority. Presenters retain only the Stage 19.8 channel actions explicitly assigned to them.

## Playout and rollback

The current effective source is resolved inside `resolvePlayerProgramming`. The protected relay re-runs the unified decision, listener-quota check and tenant/channel checks before accepting either the active primary or a ready backup. If policy data becomes unavailable, the engine falls back to the existing External Live path or shared programming according to whether the policy is disabled or enabled.

Application rollback leaves policy and event rows dormant. Before removing the migration, disable policies and preserve required transition evidence. Retail Radio, School Radio, scheduled Online Radio, listener quotas, device locks and proof of play remain on their existing shared paths.
