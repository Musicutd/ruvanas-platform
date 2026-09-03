# Stage 18M — Product dashboards and permanent complimentary access

## Outcome

The subscriber portal now separates Ruvanas into three clear product entrances:

- **Retail Radio** for shop locations, programming, promotions, players and delivery evidence.
- **School Radio** for safeguarded creation, staff review, learning and controlled publishing.
- **Online Radio** for station setup, continuous programming, listeners and professional audio delivery.

A persistent responsive sidebar groups product dashboards, audio and playout tools, studios and media, and account and insight tools. Products not included in the organisation's effective tier remain visible but take the subscriber to plan review rather than exposing a protected workspace.

## Complimentary access rule

Complimentary access is not a timed trial:

- a Super Admin chooses one organisation and one active tier;
- the generated high-entropy code is stored only as a hash and is shown once;
- an organisation owner or manager activates it;
- the selected tier remains active without charge and without an expiry date;
- only a Ruvanas Super Admin can disable it;
- disabling it revokes active listener leases and restores the organisation's normal subscription state;
- only one issued or active complimentary code is allowed per organisation at a time.

No database migration is required because the existing complimentary-access record is already deliberately expiry-free.

## Verification

- Navigation tests cover the three product destinations and entitlement-aware locked state.
- Workspace tests confirm each dashboard is separately routed, scoped and responsive.
- Complimentary-access tests cover organisation binding, super-admin control, lack of expiry and duplicate prevention.
- Full static validation, automated regression and production compilation are required before publication.
