# Stage 30C — Simplified tabbed workspaces

## Outcome

Stage 30C reduces the amount of information shown at once across the paid Ruvanas subscriber experience. It introduces task-focused tabs and collapsible sidebar groups while preserving all existing product, permission, plan and billing boundaries.

## User experience changes

- The subscriber sidebar now opens only the current navigation group by default. People can expand or collapse other groups when needed.
- Retail, School and Online Radio product dashboards show one tool category at a time.
- Radio Programming is grouped into Schedule, Automation, Live radio, Production and DJ access.
- School Radio is grouped into Overview, People & safety, Studio, Programmes and Publishing.
- Tabs support mouse, touch and keyboard navigation and scroll horizontally on small screens.
- A selected tab is reflected in the page address so it can be bookmarked or shared.
- Opened tabs preserve their in-page state while the user moves between work areas.

## Safety boundaries

- No database schema, API, authentication, billing or entitlement behavior changes.
- Existing role and product checks remain in place.
- Restricted tools remain hidden or unavailable to people without the required role or product.
- The free staging service remains outside this change and must stay suspended during any later deployment.

## Acceptance

- Shared tab accessibility and keyboard behavior are covered by automated tests.
- Retail, School and Online dashboard grouping is covered by automated tests.
- Programming and School Radio task grouping is covered by automated tests.
- Existing static integrity and product-isolation suites remain the release gate.
