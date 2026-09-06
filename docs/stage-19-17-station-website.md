# Stage 19.17 — Station Website

## Outcome

Stage 19.17 gives each active Online Radio station a professional public website without introducing a second station, player, podcast or scheduling system. The station page reuses the Stage 19.14 protected public player, Stage 19.16 podcast publication, and the Stage 19.6 unified playout decision for safe now-playing metadata.

Subscribers manage the website from the station workspace. Publication is off by default and requires an organisation owner or manager, an active station and an already published public player.

## Listener experience

- `/radio/{stationSlug}` is the canonical station website.
- Three responsive themes support a station logo, headline, long-form story, hero image and accent colour.
- A safe public endpoint refreshes current programme metadata without creating a listening lease or exposing an audio URL.
- **Listen live** opens the existing capacity-controlled player.
- Public Online Radio podcast series appear automatically with protected listening and RSS links.
- A bounded public contact address and up to six HTTPS links support the station’s external community.
- Dynamic metadata, canonical links and `RadioStation` structured data provide a search-ready foundation.

## Custom domains

Owners and managers can register a hostname owned by their organisation. Ruvanas creates a DNS TXT challenge beneath `_ruvanas-radio.{hostname}`. Verification uses DNS evidence and records an audit event. Only a verified domain can be activated, and only one domain can be active for a station at a time.

When the hostname is attached to the paid Ruvanas delivery service, root requests are safely rewritten to the active station page. Unknown, unverified, disabled and inactive domains fail closed to the ordinary Ruvanas homepage. Provider-side certificate and hostname attachment remains an explicit operational step; the application never creates provider credentials.

## Security and privacy

- Tenant identity comes only from the authenticated organisation session.
- Website and domain changes require owner or manager capability.
- Public queries require an active station, published website and active service entitlement.
- Public responses omit organisation IDs, subscription details, source/provider credentials, media storage keys, approval records and internal playout evidence.
- Images and external links require HTTPS without embedded credentials; all copy and collections have strict bounds.
- Now-playing is metadata-only and disables operational evidence writes.
- Unpublishing the website automatically deactivates its domain route while retaining verified ownership evidence.

## Rollback

Unpublish station websites and disable active custom domains first. Application rollback leaves additive station presentation fields and domain ownership evidence dormant. Removing domain records or schema fields is destructive and requires a separate retention review. The public player, podcasts, station identity and all Retail and School Radio paths remain independent.
