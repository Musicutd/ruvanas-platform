# Stage 18B — Administration Command Centre

Stage 18B reorganises the administration portal into a professional, role-aware command centre. It improves navigation and operational visibility without changing platform permissions, customer entitlements, billing behaviour or playback control.

## Administration experience

- A persistent tab system groups tools into Overview, Radio, Content, Products, Customers and Operations.
- The selected tab exposes a focused second row of tools instead of showing every destination at once.
- A new administration overview summarises organisations, active services, stations, live streams, playback and support work.
- A fourteen-day chart uses aggregated completed-playback evidence already held by the platform.
- A service-estate chart compares organisations, active stations, configured players and currently online players.
- Recent customer organisations and permission-filtered daily shortcuts support common operational work.
- The layout is responsive for desktop, tablet and mobile administration.

## Access and data safety

- Tabs are built from the existing role-filtered administration navigation.
- Super Admin-only destinations remain hidden from Support users.
- Charts use aggregate operational counts and do not expose audience identities or personal listening data.
- Existing route-level authentication and role enforcement remain authoritative.

## Verification

- Navigation tests confirm role filtering, tab semantics and unique destinations.
- Static checks confirm accessible SVG chart labelling and mobile breakpoints.
- The complete automated test suite, static integrity checks and production build must pass before publication.
