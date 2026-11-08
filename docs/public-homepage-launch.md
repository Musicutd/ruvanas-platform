# Public homepage launch

Only Retail is currently promoted on the homepage. This is a marketing setting,
not a product permission, subscription or streaming change.

- `lib/public-homepage-launch.mjs` holds the reviewed homepage product allowlist.
- `app/page.js` retains all pillar definitions and filters them for the homepage.
- `assets/public-homepage-source/index.html` preserves the complete seven-pillar
  homepage from commit `5abb6f4`. It is outside the public route's two-file allowlist.
- `assets/private-preview-public-site/index.html` is the generated public page.

For a later pillar launch, review the pillar and homepage copy, update the allowlist,
then run `node scripts/build-public-homepage.mjs --write`. Review the generated
page and updated manifest together; run the homepage tests and production build.
The generator refuses unreviewed changes to its retained source.

Public registration stays closed. Other pillars' subscriber routes, plans, guides,
saved work and streaming services are unchanged. The homepage's How it works links
land on the existing Retail guide.
