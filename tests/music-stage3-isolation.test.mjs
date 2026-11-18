import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.mjs";

// Stage 3: completely offline test harness. No Cloudflare account, live KV,
// Telegram token, third-party music API, or production webhook is used.
function mockState() {
  const data = new Map();
  const metadata = new Map();
  return {
    data,
    metadata,
    async get(key) { return data.get(key) ?? null; },
    async put(key, value, options = {}) {
      data.set(key, value);
      metadata.set(key, options.metadata ?? null);
    },
    async list({prefix = "", limit = 1000, cursor} = {}) {
      const all = [...data.keys()].filter(k => k.startsWith(prefix)).sort();
      const offset = Number(cursor ?? "0");
      const names = all.slice(offset, offset + limit);
      const end = offset + limit >= all.length;
      return {
        keys: names.map(name => ({name, metadata: metadata.get(name) ?? undefined})),
        list_complete: end,
        cursor: end ? undefined : String(offset + limit)
      };
    }
  };
}

function mockEnv() {
  return {
    STATE: mockState(),
    BOT_TOKEN: "STAGE3_FAKE_TOKEN",
    WEBHOOK_SECRET: "STAGE3_FAKE_WEBHOOK_SECRET"
  };
}

async function postUpdate(env, update, secret = env.WEBHOOK_SECRET) {
  return worker.fetch(new Request("https://staging.invalid/telegram", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": secret
    },
    body: JSON.stringify(update)
  }), env);
}

test("invalid webhook secret cannot register a user or contact Telegram", async t => {
  const initial = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Unexpected external network access"); };
  t.after(() => { globalThis.fetch = initial; });
  const env = mockEnv();
  const response = await postUpdate(env, {
    update_id: 30001,
    message: {chat: {id: 94001, type: "private"}, text: "/start"}
  }, "invalid");
  assert.equal(response.status, 401);
  assert.equal(env.STATE.data.size, 0);
});

test("a private user can open the legacy menu with only an in-memory KV", async t => {
  const initial = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const endpoint = String(url);
    assert.ok(endpoint.startsWith("https://api.telegram.org/botSTAGE3_FAKE_TOKEN/"));
    const method = endpoint.split("/").at(-1);
    const payload = JSON.parse(options.body);
    calls.push({method, payload});
    return {ok: true, status: 200, json: async () => ({ok: true, result: true})};
  };
  t.after(() => { globalThis.fetch = initial; });
  const env = mockEnv();
  const update = {
    update_id: 30002,
    message: {
      chat: {id: 94002, type: "private"},
      from: {id: 94002},
      text: "/menu"
    }
  };
  assert.equal((await postUpdate(env, update)).status, 200);
  assert.equal((await postUpdate(env, update)).status, 200, "replayed update is idempotent");
  const sent = calls.filter(c => c.method === "sendMessage");
  assert.equal(sent.length, 1);
  const buttons = sent[0].payload.reply_markup.inline_keyboard.flat().map(b => b.callback_data);
  for (const existing of ["price:menu", "weather:menu", "news:refresh", "sources:show", "support:show", "menu:close"]) {
    assert.ok(buttons.includes(existing), "Baseline button missing: " + existing);
  }
  const user = JSON.parse(await env.STATE.get("user:94002"));
  assert.equal(user.notifications_enabled, false);
  assert.equal(await env.STATE.get("update:30002"), "1");
});

test("non-private chats do not register users", async t => {
  const initial = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("No network expected"); };
  t.after(() => { globalThis.fetch = initial; });
  const env = mockEnv();
  const response = await postUpdate(env, {
    update_id: 30003,
    message: {chat: {id: -100944, type: "supergroup"}, text: "/menu"}
  });
  assert.equal(response.status, 200);
  assert.equal(env.STATE.data.has("user:-100944"), false);
});

test("test environment health endpoint does not install a real webhook", async t => {
  const initial = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Health check made an external request"); };
  t.after(() => { globalThis.fetch = initial; });
  const env = {STATE: mockState()};
  const result = await worker.fetch(new Request("https://staging.invalid/health"), env);
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.configured, false);
  assert.equal(data.webhook, "not_configured");
  assert.equal(data.timezone, "Asia/Tehran");
  assert.equal(env.STATE.data.size, 0);
});

test("unrecognized cron never activates the existing production schedules", async () => {
  const env = mockEnv();
  const tasks = [];
  await worker.scheduled({cron: "25 12 * * *", scheduledTime: Date.now()}, env, {
    waitUntil(promise) { tasks.push(promise); }
  });
  assert.equal(tasks.length, 0);
  assert.equal(env.STATE.data.size, 0);
});
