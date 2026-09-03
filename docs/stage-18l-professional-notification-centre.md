# Stage 18L — Professional Notification Centre

## Purpose

Stage 18L turns the subscriber notification feed into a clear, task-led workspace without changing the established delivery evidence or external notification controls.

## Subscriber experience

- Summary cards show unread updates, critical attention items, warnings and all active updates.
- Tabs separate all, unread and critical notifications.
- A service-area filter narrows playback, account, content, production and School Radio updates.
- Notifications are grouped into today, yesterday and earlier using the subscriber's local browser time.
- Plain-language labels replace backend event codes.
- Every supported notification includes a direct, internal action leading to the appropriate subscriber workspace.
- Subscribers can mark one or all notifications as read and dismiss read updates in bulk.
- Dismissal clearly retains the underlying operational record.
- Personal in-app and email preferences remain together in a responsive side panel.

## Safety and tenancy

- Counts, filters, updates and preferences derive the user and organisation from the authenticated session.
- No organisation, user or event scope is accepted from the browser.
- Presented records exclude metadata, correlation identifiers, entity identifiers and delivery failure details.
- Filter input is allow-listed and list size is bounded.
- Bulk operations affect only active in-app deliveries belonging to the signed-in user and organisation.
- Email remains explicit opt-in and unavailable until the approved provider is configured.
- Essential security or legal messages may remain mandatory under existing platform policy.

## Release validation

- Helper tests cover bounded filters, tenant query construction, safe presentation, direct action routing and date grouping.
- Source checks cover authenticated tenant derivation and scoped bulk operations.
- Interface checks cover tabs, native filters, status feedback, confirmations, keyboard focus and mobile layouts.

No migration is required. The free staging service remains outside this release and must stay suspended.
