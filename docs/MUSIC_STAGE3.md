# 🎧 Rasadino Music — Stage 3: Safety and testing

**Status:** preparation only; no production deployment.

## Production baseline
- Repository: `hamidhosseinis/rasadino-bot`
- Production branch: `main`
- Baseline commit: `ec7e08772200b8c4dfd45ba43348f533d47900f2`
- Live Worker: `hamid-price-report-bot`
- Feature branch: `feature/music-stage3-20261118`

The live Worker, Telegram webhook, production STATE binding, and all three existing Crons are **out of scope** for this stage.

## Branch-only validation
- `node --check src/worker.mjs`
- `node --test tests/*.test.mjs`
- `tests/music-stage3-isolation.test.mjs` runs with fake Telegram credentials, a mocked network and an in-memory KV. It cannot send messages or write live data.
- The existing GitHub workflow tests feature branches and does not deploy to Cloudflare.
- The separate read-only provider preflight workflow probes metadata endpoints without tokens, downloads or user data. A successful connection does **not** grant rights to copy music.

## Private KV snapshot
A separate namespace under the Cloudflare account stores a snapshot of the **persistent** production KV keys. Original metadata was preserved and the copied values were verified against source reads. The snapshot has its own manifest; its namespace identifier and any private user data must not be committed to this public repository.

**Expiring** update-deduplication, send-history and temporary news-view keys were deliberately omitted, to avoid changing retention or exhausting the free KV write quota. This means this is a scoped persistent-state snapshot, not a full export and not an atomic database backup. It is also not off-account disaster recovery.

Never bind the snapshot namespace to a public Worker. Any restore requires a separate reviewed plan, a comparison against current production data and explicit owner approval.

## Staging rules
1. Never reuse production Telegram BOT_TOKEN, WEBHOOK_SECRET, PUBLIC_URL or STATE in staging.
2. The current `GET /health` route may install a webhook when those credentials are present: avoid calling it from staging with live credentials.
3. No scheduled messages, live Telegram writes or background music tasks may be enabled in staging.
4. Use a distinct test bot and KV namespace only if needed and explicitly approved; offline GitHub Actions tests are the default.
5. Preserve all existing prices, weather, news, sources, support and alert flows.

## Production release gates
1. Refresh baseline SHA, active Worker version, bindings and Crons.
2. Confirm network/API access and legal terms for each provider, including any API rate limits.
3. Validate callback ownership, user privacy, rate limits, and opt-in/opt-out behavior.
4. Run regression tests and isolated smoke tests before requesting a PR merge.
5. Review the release diff; only then publish a new Worker version.
6. Validate the live Telegram bot with two independent accounts.
7. Rollback Worker **code** to the recorded version if necessary. KV restoration is a separate, explicitly approved operation.

**No release is authorized by this document.**
