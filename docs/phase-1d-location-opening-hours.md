# Stage 1D: location opening hours and date exceptions

## Purpose

This milestone adds the location operating calendar required by the master build specification. It extends the existing Location hierarchy and does not create a separate scheduling engine. The same model can later represent retail shops and school campuses.

## Behaviour

- Each location has one local weekly opening window for every weekday, or can be marked closed for that day.
- A closing time earlier than the opening time represents an overnight window.
- Special-date exceptions override the weekly timetable for holidays, events, early closing, or full-day closure.
- Times are stored as local minutes plus the location's existing IANA timezone. They are not converted into a fixed UTC offset, so daylight-saving changes retain the intended wall-clock time.
- The shared evaluator resolves the location-local date and time with `Intl.DateTimeFormat`, applies date exceptions first, and supports overnight carry-over.

## API and UI

- `PUT /api/admin/locations/:locationId/opening-hours` atomically replaces the seven-day timetable and date exceptions.
- `/admin/locations/:locationId` includes a non-technical weekly and special-date editor.
- The interface identifies the active timezone and explains daylight-saving behaviour.

## Security and data integrity

- The existing platform-admin policy protects the update route.
- The server validates all seven unique weekdays, strict `HH:mm` values, real calendar dates, duplicate dates, maximum exception count, and the location's IANA timezone.
- PostgreSQL check constraints enforce weekday and time-window invariants even outside the application.
- The replacement is a serializable transaction and writes one `LOCATION_OPENING_HOURS_UPDATED` audit record.
- Foreign keys cascade schedules when a location is deliberately removed.

## Verification and rollback

- Unit coverage includes validation, invalid timezones, overnight hours, exception precedence, and both European DST transitions.
- Route integration coverage verifies unauthenticated denial, role denial, persistence, and audit creation.
- Rollback requires reverting the application before dropping the two new tables. Existing Location, Zone, Channel, and player data are not modified by this migration.
