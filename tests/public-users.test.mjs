import test from "node:test";
import assert from "node:assert/strict";
import worker, {notificationTargets, registerUser} from "../src/worker.mjs";

function fakeState(seed = {}) {
  const values = new Map(Object.entries(seed));
  const metadata = new Map();
  return {
    values,
    metadata,
    async get(key) { return values.get(key) ?? null; },
    async put(key, value, options = {}) {
      values.set(key, value);
      metadata.set(key, options.metadata ?? null);
    },
    async delete(key) {
      values.delete(key);
      metadata.delete(key);
    },
    async list({prefix = "", cursor, limit = 1000} = {}) {
      const all = [...values.keys()].filter(x => x.startsWith(prefix)).sort();
      const offset = Number(cursor || 0);
      const page = all.slice(offset, offset + limit);
      return {
        keys: page.map(name => ({name, metadata: metadata.get(name) ?? undefined})),
        list_complete: offset + limit >= all.length,
        cursor: offset + limit >= all.length ? undefined : String(offset + limit)
      };
    }
  };
}
function env(state = fakeState()) {
  return {
    STATE: state,
    BOT_TOKEN: "FAKE_TELEGRAM_TOKEN",
    WEBHOOK_SECRET: "test-only-webhook-secret",
    LINK_CODE: "test-owner-pin",
    PUBLIC_URL: "https://example.invalid"
  };
}
function fakeTelegram(t) {
  const initialFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (!target.startsWith("https://api.telegram.org/bot")) {
      throw new Error("Mock external price provider offline");
    }
    const method = target.substring(target.lastIndexOf("/") + 1);
    const payload = options.body ? JSON.parse(options.body) : {};
    calls.push({method, payload});
    const result = method === "getWebhookInfo"
      ? {url:"https://example.invalid/telegram", allowed_updates:["message", "callback_query"]}
      : true;
    return {ok:true, status:200, json:async () => ({ok:true, result})};
  };
  t.after(() => {globalThis.fetch = initialFetch;});
  return calls;
}
async function message(e, chatId, text, updateId) {
  const request = new Request("https://example.invalid/telegram", {
    method:"POST",
    headers:{"Content-Type":"application/json",
      "X-Telegram-Bot-Api-Secret-Token":"test-only-webhook-secret"},
    body:JSON.stringify({update_id:updateId,
      message:{chat:{id:chatId,type:"private"},from:{id:chatId},text}})
  });
  return worker.fetch(request,e);
}
async function callback(e, chatId, senderId, updateId) {
  const request = new Request("https://example.invalid/telegram", {
    method:"POST",
    headers:{"Content-Type":"application/json",
      "X-Telegram-Bot-Api-Secret-Token":"test-only-webhook-secret"},
    body:JSON.stringify({update_id:updateId,
      callback_query:{id:"callback-"+updateId,data:"main:menu",from:{id:senderId},
        message:{chat:{id:chatId,type:"private"}}}})
  });
  return worker.fetch(request,e);
}
async function cron(e, dateString) {
  const tasks = [];
  await worker.scheduled({cron:"30 6,18 * * *",scheduledTime:Date.parse(dateString)},e,{
    waitUntil(promise) {tasks.push(promise);}
  });
  await Promise.all(tasks);
}

test("webhook rejects requests without its Telegram secret", async () => {
  const e = env();
  const response = await worker.fetch(new Request("https://example.invalid/telegram",{
    method:"POST",body:JSON.stringify({update_id:1}),
    headers:{"Content-Type":"application/json"}
  }),e);
  assert.equal(response.status,401);
});
test("any private Telegram user can /start; no one is auto-subscribed", async (t) => {
  const calls = fakeTelegram(t);
  const e = env();
  assert.equal((await message(e,2001,"/start",1)).status,200);
  assert.equal((await message(e,2002,"/start",2)).status,200);
  assert.equal(JSON.parse(await e.STATE.get("user:2001")).notifications_enabled,false);
  assert.equal(JSON.parse(await e.STATE.get("user:2002")).notifications_enabled,false);
  assert.equal(calls.filter(x=>x.method==="sendMessage").length,2);
  assert.match(calls[0].payload.text,/رصدینو/);
  assert.equal(await e.STATE.get("owner_chat_id"),null);
});
test("subscriptions and /stop are independent and never unlink owner", async (t) => {
  const calls = fakeTelegram(t);
  const e = env(fakeState({owner_chat_id:"1001"}));
  await message(e,1001,"/start",3);
  await message(e,1002,"/start",4);
  assert.equal(JSON.parse(await e.STATE.get("user:1001")).notifications_enabled,true);
  assert.equal(JSON.parse(await e.STATE.get("user:1002")).notifications_enabled,false);
  await message(e,1002,"/subscribe",5);
  assert.equal(JSON.parse(await e.STATE.get("user:1002")).notifications_enabled,true);
  await message(e,1001,"/stop",6);
  assert.equal(JSON.parse(await e.STATE.get("user:1001")).notifications_enabled,false);
  assert.equal(JSON.parse(await e.STATE.get("user:1002")).notifications_enabled,true);
  assert.equal(await e.STATE.get("owner_chat_id"),"1001");
  await message(e,1001,"/status",7);
  assert.match(calls.at(-1).payload.text,/غیرفعال/);
});
test("callback is accessible to its private-chat user, not impersonators", async (t) => {
  const calls = fakeTelegram(t);
  const e = env();
  assert.equal((await callback(e,3001,3001,8)).status,200);
  assert.equal(JSON.parse(await e.STATE.get("user:3001")).notifications_enabled,false);
  const previous = calls.filter(x=>x.method==="sendMessage").length;
  assert.equal((await callback(e,3001,9999,9)).status,200);
  assert.equal(calls.filter(x=>x.method==="sendMessage").length,previous);
  assert.equal(calls.at(-1).method,"answerCallbackQuery");
  assert.equal(calls.at(-1).payload.show_alert,true);
});
test("scheduled reports go to subscribed users only; are deduplicated per slot", async (t) => {
  const calls = fakeTelegram(t);
  const e = env(fakeState({owner_chat_id:"4001"}));
  await message(e,4002,"/start",10);
  await message(e,4003,"/start",11);
  await message(e,4002,"/subscribe",12);
  await cron(e,"2026-11-07T06:30:00.000Z");
  let sends = calls.filter(x=>x.method==="sendMessage" && x.payload.text.startsWith("📊 گزارش قیمت"));
  assert.deepEqual(sends.map(x=>String(x.payload.chat_id)).sort(),["4001","4002"]);
  await cron(e,"2026-11-07T06:30:00.000Z");
  sends = calls.filter(x=>x.method==="sendMessage" && x.payload.text.startsWith("📊 گزارش قیمت"));
  assert.equal(sends.length,2);
  await message(e,4001,"/stop",13);
  await cron(e,"2026-11-07T18:30:00.000Z");
  sends = calls.filter(x=>x.method==="sendMessage" && x.payload.text.startsWith("📊 گزارش قیمت"));
  assert.deepEqual(sends.map(x=>String(x.payload.chat_id)).sort(),["4001","4002","4002"]);
});
test("KV list paging covers more than 1000 opted-in users", async () => {
  const e = env();
  for (let id = 5000; id <= 6001; id++) {
    await e.STATE.put("user:"+id,JSON.stringify({notifications_enabled:true}),{
      metadata:{notifications_enabled:true}
    });
  }
  const found = [];
  for await (const id of notificationTargets(e)) found.push(id);
  assert.equal(found.length,1002);
  assert.equal(new Set(found).size,1002);
});
test("legacy owner is preserved until their own explicit opt-out", async () => {
  const e = env(fakeState({owner_chat_id:"7001"}));
  const user = await registerUser(e,"7001");
  assert.equal(user.notifications_enabled,true);
  await e.STATE.put("user:7001",JSON.stringify({...user,notifications_enabled:false}),{
    metadata:{notifications_enabled:false}
  });
  const recipients = [];
  for await (const id of notificationTargets(e)) recipients.push(id);
  assert.deepEqual(recipients,[]);
});
