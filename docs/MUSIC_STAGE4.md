# Rasadino 🎧 Music — Stage 4: Menu-only implementation

Status: **feature branch only**, not deployed to production.

## Scope

This stage adds the **🎧 رصد موزیک** button to the main Inline menu and the `/music` command. Navigating within the music module edits the same Telegram message whenever possible. All existing Telegram callback security, news, price, weather, sources, support, subscriptions, KV binding and three Crons remain intact.

The new `src/music/menus.mjs` module is pure logic and **does not make HTTP requests, read/write KV or send Telegram messages**. The original Worker handles rendering and checks that the caller owns the private-chat callback.

### Menu flow

```
🎧 رصد موزیک / /music
  ├── 🇮🇷 فارسی
  │     └── 8 genres (pop, rock, rap, traditional, fusion,
  │                   electronic, nostalgia, all)
  └── 🇺🇸 انگلیسی آمریکایی
        └── 8 genres (pop, rock, hiphop, rnb, country,
                      electronic, jazz, all)
              └── 6 recommendation types
                    └── 1 / 3 / 5 (default) / 10 songs
                          └── Selection summary, NO music delivery
```

The type choices are:
`today` (today's trends), `new` (new releases), `classic` (all-time best),
`week` (weekly popularity), `hidden` (underrated), and `smart` (personalized choice).

All music callback parameters are independently whitelisted; arbitrary genres or counts cannot trigger a request. Callback payloads are ASCII and within Telegram's 64-byte limit. The selection is encoded in the callback itself; this stage does not persist users' music choices.

## Current limitations

- The last page is a **selection summary**, not real track recommendations.
- No third-party music provider is called and no audio/link is sent.
- No likes, dislikes, recommendations, or taste learning is active.
- No daily-song subscription is created or enabled.
- No changes to `main`, live Worker, active webhook, production KV namespace or Crons.
- End-to-end Telegram validation on a separate bot has **not** yet happened.

## Tests

Use Node.js 22:

```sh
node --check src/worker.mjs
node --check src/music/menus.mjs
node --test tests/*.test.mjs
```

The new `tests/music-menu.test.mjs` checks both languages, all 8 genres
per language, 6 types, 4 counts, Persian labels, navigation, callback length,
invalid state rejection, other-user denial, main-menu regression and zero
music writes to the in-memory KV. Telegram requests are fully mocked.

Before any publication, review the independent backup from stage 3, CI status,
release diff, and test the interface with a separately configured Telegram
bot and KV. **Do not deploy this feature branch directly to the live bot.**
