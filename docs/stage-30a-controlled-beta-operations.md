# Stage 30A Controlled Beta Operations and Customer Feedback

## Outcome

Stage 30A turns the completed three-product registration release into a controlled wider-beta workflow. Ruvanas can create bounded beta programmes, admit selected organisations for the Retail, School or Online Radio product they already own, pause or complete participation, and triage structured subscriber feedback.

Beta participation is operational evidence only. It does not create a subscription, change a plan, grant a product, alter a catalogue entitlement, issue complimentary access or create a billing event.

## Super Admin workflow

The **Beta operations** control centre is available under **Customers and business**. A Super Admin can:

1. create a draft programme with a purpose, capacity and optional operating dates;
2. activate or pause the programme;
3. add an organisation for exactly one existing product entitlement;
4. pause, complete or permanently remove participation; and
5. close the programme when the cohort is finished.

Admission fails closed when the programme is not open, its capacity is full, the organisation has no active subscription record or its effective entitlements do not include the chosen product. Support users can inspect programmes and triage feedback but cannot grant or change beta participation.

## Subscriber workflow

An organisation with active participation in an active programme receives a **Beta feedback** destination in its subscriber portal. Participants can submit:

- the product and programme being tested;
- a bounded feedback category;
- testing impact from minor to blocker;
- an optional one-to-five experience rating;
- a short subject; and
- a structured description of what they attempted, observed and expected.

Owners and managers can see feedback from their organisation. Other members can see only feedback they submitted. Student accounts cannot access the workflow. The form warns users not to include passwords, payment information, student identities, private media links or other confidential information.

## Operational feedback queue

Super Admin and Support can move feedback through **New**, **Triaged**, **Planned**, **In progress**, **Resolved** and **Closed** states. A visible response is required before resolution or closure. Blockers remain highlighted until resolved or closed.

Every programme, participation and feedback change creates an audit record containing bounded operational identifiers and status information. Feedback descriptions are not duplicated into audit details.

## Data and security boundaries

- Beta records are tenant-scoped and product-aware.
- Participation never substitutes for product entitlement checks.
- Removed participants cannot be reactivated; a later programme must create a new accountable admission.
- Subscriber submissions are rate-limited to five per user and organisation per hour.
- Programme capacities are bounded between one and 500 organisations.
- Closing a programme is terminal; historical evidence remains available.
- No credentials, billing-provider actions, customer media, student data or supplier information are required by this workflow.

## Deployment

Apply the forward-only Stage 30A migration, run the complete test suite and production build, and deploy only to the paid `ruvanas-platform` service after review. Keep the free staging service suspended and untouched.
