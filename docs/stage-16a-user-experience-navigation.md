# Stage 16A — User Experience and Navigation Foundation

Stage 16A begins the usability programme after completion of the core Retail Radio, School Radio and controlled shop-player roadmap. It does not add a subscription capability or change tenant access. It makes the existing product easier to understand and prepares a consistent foundation for later guided workflows.

## Subscriber experience

- The subscriber home screen is organised around three familiar jobs: run the radio, create and schedule, and monitor and report.
- Optional products appear only when the organisation has the corresponding entitlement.
- One server-derived next action guides a subscriber from station creation to shop-player setup, connection and normal monitoring.
- The four most useful service indicators are visible at a glance; technical plan limits remain available in a collapsed detail panel.
- The dashboard uses responsive layouts, semantic headings, visible focus behaviour and plain-language descriptions.

## Administration experience

- The former flat list of administration links is grouped into radio setup, content and campaigns, products and schools, customers and business, and platform operations.
- Groups use compact disclosure controls so the header no longer presents every destination with equal visual weight.
- Support users continue to see only their existing permitted destinations. Super-admin-only destinations are still removed on the server.
- Direct links to the client home and sign-out action are consistently available.

## Security and operational boundaries

- Existing route guards remain authoritative; navigation visibility never grants access.
- No database schema, customer record, subscription limit, player identity, stream session or deployment configuration changes.
- No analytics claims or inferred audience data are introduced.
- The free staging service remains outside this work.

## Verification

Automated coverage proves entitlement filtering, new-organisation routing, the ordered setup journey, support-role filtering and unique administration destinations. Release verification also includes the full regression suite, static integrity checks and a production build.

## Next usability increment

Stage 16B should apply the same language and page structure to the highest-traffic journeys: station setup, music scheduling, shop-player setup and subscriber media upload. It should add progress indicators, consistent success/error summaries and contextual help without weakening validation or permissions.
