# Stage 16E — Usability Validation and Help Centre

Stage 16E closes the first usability programme with a searchable, role-aware subscriber help centre and consistent access to guidance from the complete first-use journey. It also removes outdated station wording and adds keyboard skip links to the priority subscriber routes.

## Subscriber help centre

- Eight plain-language articles cover getting started, station setup, managed music and schedules, shop players, audio uploads, live streams, account roles and troubleshooting.
- Search runs locally in the browser against bounded product guidance. It sends no search text to a server and creates no tracking record.
- Search requires all entered terms and provides a clear empty result with a one-click reset.
- Each article uses a native disclosure control for concise scanning and keyboard operation.
- Known article identifiers produce internal contextual links; unknown identifiers fall back to the help-centre home.

## Contextual guidance

- The subscriber dashboard opens the getting-started guide.
- Station identity and streaming setup open the station guide.
- Shop-player setup opens the enrolment and readiness guide.
- Audio upload opens the subscriber-content guide and preserves the distinction from the Ruvanas-managed music catalogue.
- The subscriber task navigation includes the Help Centre for recurring questions.
- Experienced operators can keep contextual panels collapsed and continue using every existing advanced control.

## Journey assurance

- Owner and manager guidance identifies the controlled actions they may perform.
- Viewer guidance remains explicitly view-only and directs changes to an owner or manager.
- The help centre does not grant access; all existing server-side permissions remain authoritative.
- Priority routes include a focus-visible skip link and a stable main-content target.
- Search results and empty results use live or status semantics without interrupting the user.
- Responsive help cards become a single column on smaller screens.

## Product consistency closure

- The station page no longer describes Media Library and AutoDJ as a future capability.
- It now directs subscribers to the existing media library and shop-player setup.
- Terminology consistently separates organisation-owned promotional audio, Ruvanas-managed music programming and verified shop playback.

## Security and operational boundaries

- No database migration, customer-data rewrite, entitlement change, subscription change, audio-engine change or new analytics is introduced.
- Help content contains no secrets, infrastructure identifiers or provider credentials.
- Search remains client-side and bounded to 80 characters.
- The free staging service remains outside this work.

## Verification and sign-off

- Automated coverage validates article integrity, search behaviour, role-specific language, safe contextual links, subscriber navigation, disclosure semantics, skip links and responsive focus styling.
- The complete regression suite, static-integrity checks and production build remain release gates.
- After deployment verification, Stage 16A–16E can be signed off as the initial Ruvanas usability programme. Future interface work can proceed as normal product improvement rather than a required foundation stage.
