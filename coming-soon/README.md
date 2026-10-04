# Ruvanas Coming Soon cover

This is a separate public teaser surface. It does not serve the Ruvanas platform, dashboards, or C8/C9 code. The form and HTML must be served together by `node coming-soon/interest-server.mjs` so that `/api/interest` remains same-origin.

The current static-only cover hosting cannot process the form. Do not publish the updated HTML there by itself: that would display a form whose POST cannot be delivered. A future release needs an approved web-service hosting change, a tested mail provider, and a private recipient configured before the form is presented publicly. No such deployment is performed by this branch.

Server-only configuration:

- `RUVANAS_INTEREST_RECIPIENT`: private destination address; never put it in HTML, JavaScript, public environment variables, logs, or responses.
- `NOTIFICATION_EMAIL_ENDPOINT`, `NOTIFICATION_EMAIL_TOKEN`, `NOTIFICATION_EMAIL_FROM`: existing server-side mail-provider contract. Optional existing provider failover settings also apply.
- `PORT` and `HOST`: listener settings; `HOST` defaults to `0.0.0.0` for service hosting.

Without a valid recipient and provider, submissions fail closed and the page shows a generic error. Do not call the form live until delivery has been tested on the intended, isolated cover service. No local files or production database tables store enquiries.

Local verification: `node --test tests/coming-soon-interest.test.mjs`. The tests use a simulated provider and fictional contact details; no email is sent.
