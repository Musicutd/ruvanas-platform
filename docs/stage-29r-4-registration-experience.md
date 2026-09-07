# Stage 29R.4 Guided Product Registration Experience

Status: **READY TO PUBLISH FOR REVIEW**

## Outcome

Registration is now a short, product-aware journey for Retail Radio, School Radio and Online Radio. Customers choose an explicit service and an eligible plan, enter the owner and organisation details, review their selection, and land in the product dashboard returned by the Stage 29R.3 server contract.

The homepage pricing and registration experience now use the same authoritative fifteen-plan catalogue as server-side registration. Outdated three-tier prices and invalid tier slugs have been removed.

## Guided journey

The four steps are:

1. **Service** — choose Retail / In-house Radio, School Radio or Online Radio.
2. **Plan** — choose one of the four self-service tiers or review the controlled Enterprise option.
3. **Details** — enter the account owner, organisation, email and password.
4. **Review** — confirm service, plan, trial state and music-availability wording before account creation.

Moving backward preserves all owner and organisation details. Every service and plan selection uses a native radio control with a visible selected label, so the state is not communicated through colour alone.

## Pricing deep links

Links such as `/register?platform=retail&tier=retail-professional` are resolved against the fixed catalogue before they reach the interactive journey. A valid matching plan is visibly marked **Selected from pricing** and can still be changed.

Mismatched or invented tiers never create a selection. A valid product can remain selected so the customer can choose from its approved plans. Enterprise links show a tailored-setup notice and cannot submit an unrestricted self-service Enterprise registration.

## Shared pricing authority

The public homepage now renders all five tiers for each product directly from the plan catalogue introduced in Stage 29R.2:

- Retail Start, Retail Business, Retail Professional, Retail Advanced and Retail Enterprise;
- School Start, School Create, School Pro, School Academy and Education Enterprise;
- Online Hobby, Online Starter, Online Professional, Online Station Pro and Online Network.

Names, public slugs, monthly baselines, limits and Licensed Music Catalogue levels are no longer duplicated in an independent homepage price array.

## Accessibility and responsive behaviour

The journey includes:

- a skip link and labelled progress indicator;
- fieldsets and legends for service and plan choices;
- visible keyboard focus around every interactive card and control;
- focus movement to each new step heading;
- focus and live announcement for validation errors;
- labels, autocomplete values, length limits and password guidance;
- a one-column mobile layout for service cards, plans, fields and review rows;
- reduced-motion support.

## Submission and redirect

The final request submits only the bounded Stage 29R.3 fields: owner details, organisation name, product, tier and registration source. On success, the browser follows `recommendedDashboardRoute` rather than assuming every subscriber belongs on the generic dashboard.

The server remains authoritative for plan availability, price, capabilities, trial state and redirect. Browser query parameters and displayed text never grant access.

## Validation coverage

Automated tests protect:

- all fifteen catalogue-driven plan cards and approved prices;
- valid Retail, School and Online deep-link preselection;
- code and slug resolution;
- mismatch, invented-tier and Enterprise fail-closed behaviour;
- Licensed Music Catalogue wording and tier ladder;
- accessible selection, error and progress semantics;
- mobile and reduced-motion rules;
- product-aware API payload and returned-route handling;
- absence of the obsolete hard-coded public prices.

## Next milestone

Stage 29R.5 will enforce explicit Retail, School and Online capabilities across product cards, subscriber navigation and direct dashboard access. It will ensure that owning one product never exposes another product’s operational tools.
