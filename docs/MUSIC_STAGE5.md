# 🎧 Rasadino Music — Stage 5: Metadata Search (feature branch only)

**Status:** code + simulated regression tests complete; **not deployed to the public bot**.

## New search UX

1. `/music` or the 🎧 main-menu button.
2. Select 🇮🇷 Persian or 🇺🇸 US-English.
3. Tap «🔎 جست‌وجوی آهنگ یا خواننده».
4. Send the song or artist name as the **next private-chat message** within five minutes.
5. Alternatively use `/findmusic fa گوگوش` or `/findmusic us Taylor Swift` directly.

The resulting message includes at most five distinct songs with source, artist, optionally album/year/genre, and **HTTPS links to official provider pages**. No MP3 or preview is downloaded, cached or sent. The search is **not** a chart, validated language classifier, US-artist nationality check or personalized recommendation.

Existing genre/type/count menus from Stage 4 still end at an honest selection summary; the recommendation engine is a **future** stage.

## Provider implementation

- `src/music/providers.mjs`: fixed-domain iTunes Search API (`country=US`, song media only) and Audius search adapters. Public metadata only. URL host allow-list; never propagate preview/audio/CID fields.
- `src/music/search.mjs`: input validation, provider isolation through `Promise.allSettled`, cross-provider deduplication, TTL cache, per-chat best-effort cooldown, and plain-text Telegram results.
- Apple iTunes: US storefront is a catalog location, **not verified artist citizenship**. Persian-script coverage is incomplete.
- Audius: real search API returns **root-relative** permalinks (`/artist/track`). Normalization was fixed to resolve them only to `https://audius.co` and to reject control characters and external hosts. A subsequent 2026-11-18 GitHub-runner preflight verified 12 usable metadata results each for `Skrillex`, `music`, and `electronic` (three of three queries). This proves runner access, **not** access from a deployed Cloudflare Worker.
- MusicBrainz: metadata enrichment is postponed until rate limiting (1 req/second per IP), actual availability and proper User-Agent are safely handled.
- No live MusicBrainz, Spotify, Apple Music paid developer APIs or scraping is enabled.

## Cache and privacy

- Cache key: `music:search:v1:<language>:<SHA256 of canonical query>`.
- Provider results contain public song metadata only; never store the raw search term, a chat ID or Telegram profile in shared cache.
- Full successful results: KV expiration 2 hours. Empty/partial results: 5 minutes.
- Errors from all providers: no cache write; user sees a temporary-unavailable message.
- Private pending-search language only: `music:pending:<chat_id>`, 5-minute TTL; consumed after one message or cleared on music navigation/menu close.
- Best-effort user throttle: `music:search:cooldown:<chat_id>`, minimum 8 seconds between requests; 60-second expiration.
- KV is **eventually consistent**, so this throttle is **not atomic**, nor a guaranteed global provider rate limiter. Review Cloudflare free-tier KV writes and upstream per-IP quotas before public enablement.
- The existing price-alert subscription is never modified by music search; no daily-song subscription exists yet.
- Do not log queries, message content, user IDs or upstream result payloads.

## Validation and release boundaries

GitHub Actions runs `node --check src/worker.mjs` and `node --test tests/*.test.mjs` against the feature branch only.

`tests/music-search.test.mjs` covers:
- text input and both language paths
- malicious links and malformed provider results
- cache deduplication and failed/partial source behavior
- user throttling and no impact on price notification settings
- private callbacks and temporary search session cancellation
- text search, mock Telegram responses and absence of `sendAudio`

`music-search-preflight.yml` performs **live external GET metadata requests from a GitHub runner only**, without API keys or user data. A verified HTTP response from GitHub does not prove a future deployed Cloudflare Worker will access the provider.

**Never deploy this branch directly to `hamid-price-report-bot`, bind it to production KV, or run with production Telegram credentials in staging.** Release requires separate staging, approval, preservation of all current Crons and rollback checks, and live Telegram verification.

## Stage 6 candidate work

Build a source-backed recommendation engine for chosen language/genre/type/count, with explicit evidence boundaries:
- do not label ordinary search results as a real chart or "today's trends";
- only display a chart rank if a dated licensed chart source provides it;
- learn user preferences only with explicit positive/negative feedback and private storage.

## Stage 5 follow-up verification (2026-11-18)

- Real provider preflight: **6/6 sample searches** produced valid metadata (3 iTunes including Persian-script, 3 Audius). Search results are samples and do not prove Persian/US artist classification.
- Cloudflare-compatible **local workerd/Miniflare** smoke: passed with synthetic music metadata, a separate local KV, zero live credentials, and no real Telegram messages. Existing Worker rejected invalid webhook requests.
- GitHub Actions regression suite: **65 passed / 0 failed**, including URL-injection and relative Audius permalink tests.
- Tests covered mock Telegram and local workerd. There is **no independently deployed staging Worker**, no actual Telegram test bot integration, no validated outbound iTunes/Audius access from Cloudflare production runtime, and no live bot release.
- The current Cloudflare production Worker, existing Crons and main branch are intentionally unchanged.
