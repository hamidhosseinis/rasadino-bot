# Rasadino Music — Stage 06: Source-backed Recommendations

**Status:** feature branch; production deployment requires confirmed CI, backup and preservation of original bot.

## Navigation

Telegram: `/music` → language → genre → mode → 1/3/5/10 tracks.

This stage connects the existing menu's `music:preview:language:genre:mode:count`
callback to `recommendMusic`, editing the original bot's inline message.
There are no unsolicited sends, periodic music Cron triggers, audio downloads,
new secret bindings or personal music-profile writes.

### Source-backed modes

| Mode | Source and semantics |
|---|---|
| `new` | Dated releases in the last 540 days **within the current search results**, sorted by release date. Does not claim globally exhaustive newest releases. |
| `smart` | Rule-based discovery using release recency, genre metadata when available, and artist variety. **Not individualized**; no user preferences collected. |
| `week` | Audius global trending chart, `time=week`, optionally a native Audius genre. Live source-ranked tracks only. |
| `classic` | Audius global **allTime chart**; never claim the whole music industry's greatest-of-all-time. |
| `hidden` | Audius global underground-trending discovery; a provider-specific list, not an independently measured worldwide popularity threshold. |
| `today` | Deliberately **unsupported**: no verified licensed **daily** chart endpoint yet. No substitutions or invented ranks. |

For Persian (`fa`), `week`, `classic` and `hidden` are deliberately
unsupported until a genuinely Persian chart/artist-language classification is
verified; `smart` and `new` rely on publicly searchable catalogs and explicitly
warn the listener when language/genre are unverified. All results marked
US-English are **US-storefront / global-provider discovery**, not validated
US citizenship or verified language.

## External sources

- Apple's public iTunes Search API — song metadata, dates and official links.
- Audius — song metadata, week/allTime charts and underground trending,
  via official `/v1/tracks/trending` and `/v1/tracks/trending/underground`.
- No copying/hosting/streaming of copyrighted song files. Telegram users get
  only official HTTPS link buttons and metadata.

## Cache and cost

- Shared non-personal KV keys `music:recommend:v1:<language>:<genre>:<mode>`.
- 1-hour cache for full metadata, 4-minute for partial/empty responses.
- Cache holds up to 10 songs independent of the first user's requested count.
- Existing per-user best-effort 8-second music request cooldown is reused.
- No daily song sends, music notifications or user taste history.
- Cloudflare KV is eventually consistent: neither rate-limiter nor cache
  update is atomic. Review KV free write quotas as usage increases.

## Source verification and tests

- GitHub runner live search and chart preflight (metadata-only, no tokens):
  **6/6** sample cases produced nonempty source-backed results on 2026-11-18.
- Unit/integration regressions: **75/75** passing at preflight checkpoint.
- Independent local Cloudflare workerd runtime uses an in-memory fixture
  with music recommendations, source rank, KV cache, and original Worker
  denial of invalid webhook secrets.
- Existing price/weather/news and 3 Crons unchanged in source.
- A successful real API response from GitHub does not guarantee network
  reachability from a deployed Cloudflare Worker.

## Production gates

1. Re-check latest `main` HEAD, live Worker version and all 5 binding names.
2. Create an isolated persistent-only KV backup and compare copy values.
3. Confirm all stage 6 GitHub Actions successful at final source SHA.
4. Merge reviewed PR with expected head SHA.
5. Upload new Worker **version without deploying**, inherit existing bindings
   using `bindings_inherit=strict`; verify secrets and KV namespace.
6. Publish one version with 100% traffic after a final safety check.
7. Run non-invasive production HTTP smoke, and seek manual Telegram click
   confirmation from the owner.
8. If a new production issue emerges, deploy recorded prior Worker version;
   KV restore is a separate reviewed, explicit procedure.
