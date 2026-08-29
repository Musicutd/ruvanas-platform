# Stage 6C - privacy-safe summary metric integrations

Stage 6C completes the first governed inbound integration path. Approved partner systems can submit location-level sales, inventory or footfall summaries without exposing customer, order or individual visitor records.

## Delivered foundation

- Super Admin creation of sales, inventory and footfall summary connections.
- A revocable `metrics:write` service-account scope.
- A rate-limited `POST /api/v1/integration-metrics` endpoint.
- Tenant and location ownership checks on every imported item.
- Metric types constrained to the selected connection kind.
- Provider idempotency through a stable external metric ID.
- Durable source timestamps, bounded reporting windows and sync-run history.
- Allow-listed aggregate dimensions only: category, department, source location reference and stock class.
- Audited accepted and duplicate counts without copying raw payloads into audit logs.
- Super Admin visibility of connection status, import totals and recent runs.

## Supported summaries

| Connection | Metric | Unit |
| --- | --- | --- |
| Sales | Net sales in currency minor units | `<ISO currency>_MINOR`, for example `EUR_MINOR` |
| Sales | Transaction count | `COUNT` |
| Inventory | Units on hand | `UNITS` |
| Inventory | Stockout count | `COUNT` |
| Footfall | Entries | `COUNT` |
| Footfall | Exits | `COUNT` |

Each item is linked to a Ruvanas location and contains an external ID, reporting window and source timestamp. A request can contain between 1 and 500 items; duplicate external IDs are acknowledged but not stored twice.

## Privacy and evidence boundary

This endpoint is for aggregate operational summaries. It rejects unapproved dimensions and does not accept customer names, email addresses, order lines, device identifiers or individual visitor records.

Imported figures may be compared with scheduling and playback evidence to explore operational patterns. They must not be described as audience measurement or as proof that audio caused sales, inventory movement or footfall.

## Example request

```json
{
  "connectionId": "connection-id",
  "metrics": [
    {
      "externalId": "pos:store-4:2026-09-08T10",
      "locationId": "ruvanas-location-id",
      "metricType": "POS_TRANSACTION_COUNT",
      "value": 23,
      "unit": "COUNT",
      "windowStartedAt": "2026-09-08T10:00:00.000Z",
      "windowEndedAt": "2026-09-08T11:00:00.000Z",
      "sourceTimestamp": "2026-09-08T11:05:00.000Z",
      "dimensions": {
        "department": "All retail",
        "sourceLocationRef": "store-4"
      }
    }
  ]
}
```

The request uses `Authorization: Bearer <service-account-key>`. External service-account requests do not rely on browser cookies or browser-origin checks; the bearer key, scope, tenant and connection remain authoritative.

## Next product increment

Phase 7 can now begin with a controlled retail-media inventory model. Audio and future signage inventory must remain distinct, and reporting must continue to separate scheduled intent, device-confirmed delivery and any external operational correlation.
