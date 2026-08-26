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

