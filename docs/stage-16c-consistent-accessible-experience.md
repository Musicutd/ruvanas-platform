# Stage 16C — Consistent and Accessible User Experience

Stage 16C extends the usability programme across the remaining high-use subscriber and administration screens. It standardises orientation, empty states and confirmation behaviour without changing any API, permission, subscription, streaming or evidence rule.

## Shared interface patterns

- Page headers now use one responsive structure for the page purpose, plain-language description, return route and primary actions.
- Empty states explain what is missing, why the screen is empty and the safe next action instead of presenting a passive “no records” message.
- Subscriber and administration themes retain their existing colours while sharing spacing, focus and mobile behaviour.
- User-facing service errors are flattened and bounded before display.

## Clear confirmations

- Dismissing an operational notification explains that the notification leaves the active list while its underlying operational record remains.
- Archiving a music mode explains that it is removed from new scheduling choices while audit records remain.
- Stopping a live player session explains that the stream slot is released without retiring the enrolled player.
- Confirmation dialogs use semantic labels, return focus through the native dialog interaction and support keyboard cancellation with Escape.

## Priority screens

- Subscriber notifications, operational analytics, proof-of-play reports and active shop streams.
- Administrator organisations, locations, stations, music modes and music schedules.
- Data tables on the updated administration screens identify column headers explicitly for assistive technology.

## Accessibility and responsive behaviour

- Shared controls display a high-contrast `:focus-visible` outline.
- Header actions and confirmation controls stack at narrow widths.
- Dynamic success and error messages retain status and alert semantics.
- Empty states have meaningful headings and do not claim that activity or playback has occurred.

## Security and operational boundaries

- No database migration or customer-data rewrite.
- No new credentials, tracking or audience claims.
- Existing server-side permissions and tenant boundaries remain authoritative.
- No change to player identity, stream quotas, channel playout or evidence retention.
- The free staging service remains outside this work.

## Verification

Regression coverage validates the shared page vocabulary, bounded messages, action-specific confirmation meaning, keyboard dismissal, visible focus and responsive behaviour. Release verification also includes the full automated suite, static-integrity checks and a production build.

## Next usability increment

Stage 16D should add first-use onboarding checklists and contextual help entry points for new subscribers, while keeping advanced controls available to experienced operators.
