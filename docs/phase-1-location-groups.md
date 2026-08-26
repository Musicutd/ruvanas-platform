# Phase 1: location groups

This slice adds organisation-owned groups of physical locations without replacing the existing location, zone, channel, or player models.

## Delivered

- `LocationGroup` and `LocationGroupMember` database models
- unique group slugs per organisation
- admin creation and location assignment screens
- strict organisation checks before assigning locations
- atomic membership replacement
- audit events for group creation and membership changes
- unit coverage for slugging, input normalisation, and tenant-boundary validation

Location groups provide the targeting foundation for later bulk channel assignment and regional scheduling.

## Bulk channel assignment

The next increment adds a guarded batch workflow to each location-group detail page:

- the operator selects one organisation-owned, non-archived channel;
- a client impact preview and server-verified dry run list every affected location and zone before submission;
- zones already using the selected channel remain unchanged;
- all other active assignments are closed and the selected channel is applied atomically;
- duplicate active assignments are repaired by the same operation;
- one batch audit event and a per-zone audit event record the complete change;
- groups without zones and cross-organisation channel IDs are rejected.

The operation reuses the existing `ChannelAssignment` history and requires no schema migration.

