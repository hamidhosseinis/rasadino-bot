import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.mjs";
import {musicMenuView, GENRES, TYPES, COUNTS} from "../src/music/menus.mjs";

function actions(page) {
  return page.keyboard.inline_keyboard.flat().map(button => button.callback_data).filter(Boolean);
}
function matchAction(page, value) {
  assert.ok(actions(page).includes(value), "Expected callback " + value);
}
function fakeEnv() {
  const values = new Map();
  const metadata = new Map();
  const STATE = {
    values,
    async get(key) { return values.get(key) ?? null; },
    async put(key, value, options={}) {
      values.set(key, value);
      metadata.set(key, options.metadata ?? null);
    },
    async delete(key) {values.delete(key);metadata.delete(key);},
    async list({prefix="",limit=1000,cursor}={}) {
      const keys = [...values.keys()].filter(x => x.startsWith(prefix)).sort();
      const offset = Number(cursor ?? 0);
      return {
        keys: keys.slice(offset, offset + limit).map(name => ({name, metadata:metadata.get(name) ?? undefined})),
        list_complete: offset + limit >= keys.length,
        cursor: String(offset + limit)
      };
    }
  };
  return {STATE, BOT_TOKEN:"FAKE_STAGE4_TOKEN", WEBHOOK_SECRET:"FAKE_STAGE4_WEBHOOK"};
}
function stubTelegram(t) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options={}) => {
    const endpoint=String(url);
    if(endpoint.startsWith("https://itunes.apple.com/search?"))return {
      ok:true,status:200,json:async()=>({resultCount:1,results:[{
        kind:"song",wrapperType:"track",trackId:32423,trackName:"Test Rock",
        artistName:"Test Band",collectionName:"Album",releaseDate:"2026-08-10",
        primaryGenreName:"Rock",trackViewUrl:"https://music.apple.com/us/album/test/32423?i=32423"
      }]})
    };
    if(endpoint.startsWith("https://api.audius.co/v1/tracks/search?"))return {
      ok:true,status:200,json:async()=>({data:[]})
    };
    assert.ok(endpoint.startsWith("https://api.telegram.org/botFAKE_STAGE4_TOKEN/"),"Unexpected provider/network request");
    const method = endpoint.split("/").at(-1);
    const payload = JSON.parse(options.body || "{}");
    calls.push({method,payload});
    return {ok:true, status:200, json:async () => ({ok:true,result:true})};
  };
  t.after(() => {globalThis.fetch = original;});
  return calls;
}
async function update(env, item) {
  return worker.fetch(new Request("https://example.invalid/telegram",{
    method:"POST",
    headers:{"Content-Type":"application/json","X-Telegram-Bot-Api-Secret-Token":env.WEBHOOK_SECRET},
    body:JSON.stringify(item)
  }),env);
}
function message(id, text, n) {
  return {update_id:n,message:{chat:{id,type:"private"},from:{id},text}};
}
function callback(id, action, n, sender=id) {
  return {update_id:n,callback_query:{id:"music-test-"+n,data:action,
    from:{id:sender},message:{message_id:45,chat:{id,type:"private"}}}};
}
const last = (calls,method) => calls.filter(call=>call.method===method).at(-1)?.payload;

test("music entry offers exactly Persian and US English and has main/close controls", () => {
  const home = musicMenuView();
  assert.match(home.text,/رصد موزیک/);
  matchAction(home,"music:lang:fa");
  matchAction(home,"music:lang:us");
  matchAction(home,"main:menu");
  matchAction(home,"menu:close");
});

test("both language menus expose precisely eight required genres", () => {
  assert.equal(GENRES.fa.length,8);
  assert.equal(GENRES.us.length,8);
  for (const lang of ["fa","us"]) {
    const page = musicMenuView("music:lang:"+lang);
    for(const [id] of GENRES[lang]) matchAction(page,"music:genre:"+lang+":"+id);
    assert.equal(actions(page).filter(x=>x.startsWith("music:genre:")).length,8);
    matchAction(page,"music:home");
  }
  assert.match(musicMenuView("music:lang:us").text,/آمریکایی/);
});

test("each valid genre has six distinct types and working back navigation", () => {
  assert.equal(TYPES.length,6);
  for (const lang of ["fa","us"]) for (const [genre] of GENRES[lang]) {
    const page=musicMenuView("music:genre:"+lang+":"+genre);
    assert.ok(page);
    for (const [kind] of TYPES) matchAction(page,"music:type:"+lang+":"+genre+":"+kind);
    matchAction(page,"music:lang:"+lang);
  }
});

test("every selection type offers counts 1/3/5/10 and marks five as default", () => {
  assert.deepEqual(COUNTS,[1,3,5,10]);
  for (const lang of ["fa","us"]) for (const [genre] of GENRES[lang])
    for (const [kind] of TYPES) {
      const page=musicMenuView("music:type:"+lang+":"+genre+":"+kind);
      for(const n of COUNTS) matchAction(page,"music:preview:"+lang+":"+genre+":"+kind+":"+n);
      assert.match(page.text,/پیش‌فرض: ۵/);
      assert.ok(page.keyboard.inline_keyboard.flat().some(b=>b.callback_data.endsWith(":5")&&b.text.includes("پیش‌فرض")));
      matchAction(page,"music:genre:"+lang+":"+genre);
    }
});

test("summary is honest about not sending any tracks and allows revisiting count", () => {
  const page=musicMenuView("music:preview:fa:traditional:smart:10");
  assert.match(page.text,/سنتی/);
  assert.match(page.text,/۱۰ آهنگ/);
  assert.match(page.text,/هیچ آهنگی ارسال نشده/);
  assert.match(page.text,/هیچ اشتراک روزانه‌ای فعال نشده/);
  matchAction(page,"music:type:fa:traditional:smart");
  matchAction(page,"main:menu");
  matchAction(page,"menu:close");
});

test("all callbacks are Telegram-safe (<64 bytes) and reject forged selections", () => {
  const pages=[musicMenuView()];
  for (const lang of ["fa","us"]) {
    pages.push(musicMenuView("music:lang:"+lang));
    for (const [genre] of GENRES[lang]) {
      pages.push(musicMenuView("music:genre:"+lang+":"+genre));
      for (const [kind] of TYPES) {
        pages.push(musicMenuView("music:type:"+lang+":"+genre+":"+kind));
        for(const count of COUNTS)pages.push(musicMenuView("music:preview:"+lang+":"+genre+":"+kind+":"+count));
      }
    }
  }
  for(const page of pages) for(const action of actions(page)){
    assert.ok(Buffer.byteLength(action,"utf8")<=64, "Callback too long: "+action);
    assert.match(action,/^[a-z0-9:]+$/);
  }
  for(const bad of [
    "music:lang:fr","music:lang:__proto__", "music:genre:__proto__:pop",
    "music:genre:fa:country","music:type:us:traditional:smart",
    "music:type:fa:pop:fake", "music:preview:fa:pop:smart:2",
    "music:preview:fa:pop:smart:05","music:preview:fa:pop:smart:100000",
    "music:preview:fa:pop:smart:5:extra", "music:home:extra",
    "music:"+"x".repeat(100)
  ]) assert.equal(musicMenuView(bad), null,bad);
});


test("real Worker routes /music to file-only prompt; legacy buttons cannot show links",async t=>{
  const calls=stubTelegram(t),env=fakeEnv();
  assert.equal((await update(env,message(77601,"/music",10001))).status,200);
  assert.match(last(calls,"sendMessage").text,/نام آهنگ یا خواننده/);
  matchAction({keyboard:last(calls,"sendMessage").reply_markup},"music:home");
  assert.equal(await env.STATE.get("music:pending:77601"),"file");
  const flow=["music:lang:fa","music:genre:fa:rock","music:type:fa:rock:smart",
    "music:preview:fa:rock:smart:5","music:home"];
  for(let i=0;i<flow.length;i++){
    assert.equal((await update(env,callback(77601,flow[i],10002+i))).status,200);
    assert.match(last(calls,"editMessageText").text,/نام آهنگ یا خواننده/);
    assert.equal(last(calls,"answerCallbackQuery").callback_query_id,"music-test-"+(10002+i));
  }
  assert.equal((await update(env,callback(77601,"main:menu",10010))).status,200);
  assert.equal(await env.STATE.get("music:pending:77601"),null);
  assert.equal(JSON.stringify(calls).includes("https://music.apple.com"),false);
  assert.equal(calls.filter(x=>x.method==="sendAudio").length,0);
});


test("invalid music callbacks open file-only prompt; other users cannot hijack",async t=>{
  const calls=stubTelegram(t),env=fakeEnv();
  assert.equal((await update(env,callback(77701,"music:genre:__proto__:pop",11001))).status,200);
  assert.match(last(calls,"editMessageText").text,/نام آهنگ یا خواننده/);
  const count=calls.filter(x=>x.method==="editMessageText").length;
  assert.equal((await update(env,callback(77701,"music:lang:fa",11002,77702))).status,200);
  assert.equal(last(calls,"answerCallbackQuery").show_alert,true);
  assert.equal(calls.filter(x=>x.method==="editMessageText").length,count);
  assert.equal(await env.STATE.get("user:77702"),null);
});

test("the new music item does not remove existing main menu callbacks",async t=>{
  const calls=stubTelegram(t),env=fakeEnv();
  assert.equal((await update(env,message(77801,"/start",12001))).status,200);
  const page={keyboard:last(calls,"sendMessage").reply_markup};
  for(const callbackData of ["price:menu","weather:menu","news:refresh","sources:show",
    "support:show","music:home","menu:close"])matchAction(page,callbackData);
});
