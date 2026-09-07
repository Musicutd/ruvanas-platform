# Stage 30B Beta Insights and Release Decisions

## Outcome

Stage 30B turns the controlled feedback collected in Stage 30A into accountable product evidence. The Beta operations centre now shows programme and portfolio metrics, product distribution, feedback themes, readiness findings and immutable Super Admin review decisions.

The workflow remains separate from sales and billing. It cannot create or change a subscription, plan, product entitlement, complimentary-access code, invoice or billing contract.

## Evidence dashboard

For each beta programme, the control centre presents:

- active organisations and participating products;
- feedback volume and product distribution;
- average experience rating;
- response and resolution coverage;
- feedback themes and open testing blockers;
- participation coverage; and
- a readiness state of **Blocked**, **Attention** or **Ready for decision**.

The expansion gate fails closed while a programme has no active organisation, any open blocker, any untriaged feedback, fewer than three feedback items or evidence from fewer than two active organisations.

## Accountable decisions

A Super Admin can record one of four decisions:

1. **Continue beta** — keep or return the programme to active testing.
2. **Pause and fix** — pause the programme while findings are addressed.
3. **Expand cohort** — increase the bounded organisation capacity and continue testing. This is available only when the evidence gate is clear and requires an evidence reference.
4. **End beta** — close the programme and preserve its history. This requires an evidence reference.

Each decision stores an immutable aggregate snapshot of the evidence that existed at review time. The snapshot contains counts, percentages, product codes and readiness state only. It excludes organisation names, user details, feedback subjects, feedback descriptions and Ruvanas responses.

The programme status and capacity update in the same transaction as the review record and audit event. If any part fails, no decision is recorded.

## Roles and safety boundaries

- Super Admin controls decisions, programme state and cohort capacity.
- Support can inspect insights, view decision history and continue triaging feedback, but cannot record release decisions.
- Expansion remains capped at 500 organisations.
- A closed programme cannot be reopened or reviewed again.
- Review notes are bounded and expansion or closure requires an evidence reference.
- Every decision records previous and next status, previous and next capacity, readiness, blocker count and the explicit `billingChanged: false` boundary.

## Verification and deployment

Apply the forward-only Stage 30B migration to create immutable beta review records. Run schema validation, repository integrity checks, the full unit and integration suite, and the production build. After review, deploy only to the paid `ruvanas-platform` service and keep the free staging service suspended and untouched.
