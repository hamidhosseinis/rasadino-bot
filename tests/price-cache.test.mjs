import test from "node:test";
import assert from "node:assert/strict";
import worker, {prices, refreshPriceSnapshot} from "../src/worker.mjs";

function makeEnv(seed={}) {
  const data=new Map(Object.entries(seed));
  const metadata=new Map();
  return {
    BOT_TOKEN:"TEST_ONLY_TOKEN",
    STATE:{
      data,
      async get(key){return data.get(key)??null;},
      async put(key,value,opts={}){data.set(key,value);metadata.set(key,opts.metadata??null);},
      async list({prefix="",cursor,limit=1000}={}) {
        const keys=[...data.keys()].filter(key=>key.startsWith(prefix)).sort();
        const offset=Number(cursor||0);
        return {
          keys:keys.slice(offset,offset+limit).map(name=>({name,metadata:metadata.get(name)??undefined})),
          list_complete:offset+limit>=keys.length,
          cursor:offset+limit>=keys.length?undefined:String(offset+limit)
        };
      }
    }
  };
}

function interceptFetch(t) {
  const original=globalThis.fetch;
  const calls=[];
  let failTgju=false;
  globalThis.fetch=async (url,opts={})=>{
    const target=String(url);
    calls.push(target);
    if(target.startsWith("https://api.telegram.org/bot")) {
      return {ok:true,status:200,json:async()=>({ok:true,result:true})};
    }
    if(target.includes("api.coingecko.com")) {
      return {ok:true,status:200,json:async()=>({bitcoin:{usd:100000}})};
    }
    if(target.includes("tgju.org/profile/")) {
      if(failTgju) throw Error("Simulated TGJU outage");
      return {ok:true,status:200,text:async()=>
        "<html>نرخ فعلی ۱۲٬۳۴۵٬۶۷۸ قیمت ریالی ۱٬۲۳۴٬۵۶۷"+(" معتبر".repeat(100))+"</html>"};
    }
    throw Error("Unexpected request: "+target);
  };
  t.after(()=>{globalThis.fetch=original});
  return {calls,setTgjuFailure(value){failTgju=value;}};
}

async function trigger(e,cron,scheduledTime=Date.now()) {
  const pending=[];
  await worker.scheduled({cron,scheduledTime},e,{waitUntil(task){pending.push(task);}});
  await Promise.all(pending);
}

test("10-minute Cron refreshes KV without any Telegram broadcast",async t=>{
  const {calls}=interceptFetch(t);
  const e=makeEnv({"owner_chat_id":"123"});
  await trigger(e,"*/10 * * * *",Date.UTC(2026,10,10,6,30));
  const raw=e.STATE.data.get("prices:latest:v1");
  assert.ok(raw,"snapshot must be persistent");
  const snapshot=JSON.parse(raw);
  assert.equal(snapshot.btc.value,100000);
  assert.ok(snapshot.btc.updatedAt);
  assert.ok(snapshot.usdt.updatedAt);
  assert.ok(snapshot.gold.updatedAt);
  assert.equal(calls.filter(x=>x.includes("api.telegram.org")).length,0);
  assert.equal(calls.filter(x=>x.includes("coingecko")).length,1);
  assert.equal(calls.filter(x=>x.includes("tgju.org/profile/")).length,2);
});

test("on-demand API and Telegram requests reuse the saved snapshot",async t=>{
  const {calls}=interceptFetch(t);
  const e=makeEnv();
  await refreshPriceSnapshot(e);
  const externalCount=calls.length;
  const response=await worker.fetch(new Request("https://example.invalid/prices"),e);
  assert.equal(response.status,200);
  const json=await response.json();
  assert.equal(json.quotes.btc.value,100000);
  assert.equal(json.quotes.btc.stale,false);
  const update={update_id:42,message:{chat:{type:"private",id:555},from:{id:555},text:"/price"}};
  const telegramResponse=await worker.fetch(new Request("https://example.invalid/telegram",{
    method:"POST",headers:{"Content-Type":"application/json","X-Telegram-Bot-Api-Secret-Token":"test-webhook"},
    body:JSON.stringify(update)
  }),{...e,WEBHOOK_SECRET:"test-webhook"});
  assert.equal(telegramResponse.status,200);
  assert.equal(calls.filter(x=>!x.includes("api.telegram.org")).length,externalCount);
  assert.equal(calls.filter(x=>x.includes("/sendMessage")).length,1);
});

test("a provider outage preserves recent quotes per asset",async t=>{
  const api=interceptFetch(t);
  const e=makeEnv();
  const initial=await refreshPriceSnapshot(e);
  assert.ok(initial.gold.value>0);
  api.setTgjuFailure(true);
  const next=await refreshPriceSnapshot(e);
  assert.equal(next.btc.value,100000);
  assert.equal(next.usdt.value,initial.usdt.value);
  assert.equal(next.gold.value,initial.gold.value);
  assert.equal(next.gold.updatedAt,initial.gold.updatedAt);
});

test("quotes over 20 minutes old are not shown as current",async t=>{
  const {calls}=interceptFetch(t);
  const e=makeEnv();
  const now=Date.now();
  const old=new Date(now-25*60000).toISOString();
  const recentlyChecked=new Date(now-60*1000).toISOString();
  const snapshot={at:recentlyChecked,
    btc:{value:80000,source:"CoinGecko",updatedAt:old},
    usdt:{value:100000,source:"TGJU",updatedAt:old},
    gold:{value:6000000,source:"TGJU",updatedAt:old}};
  e.STATE.data.set("prices:latest:v1",JSON.stringify(snapshot));
  const visible=await prices(e);
  assert.equal(visible.btc.value,null);
  assert.equal(visible.usdt.value,null);
  assert.equal(visible.gold.value,null);
  assert.equal(visible.btc.stale,true);
  assert.equal(calls.length,0);
});

test("only the old 10:00/22:00 Iran triggers send scheduled prices",async t=>{
  const {calls}=interceptFetch(t);
  const e=makeEnv({"owner_chat_id":"123"});
  await refreshPriceSnapshot(e);
  await trigger(e,"*/10 * * * *",Date.UTC(2026,10,10,5,30));
  assert.equal(calls.filter(x=>x.includes("/sendMessage")).length,0);
  await trigger(e,"30 6,18 * * *",Date.UTC(2026,10,10,6,30));
  assert.equal(calls.filter(x=>x.includes("/sendMessage")).length,1);
  await trigger(e,"30 6,18 * * *",Date.UTC(2026,10,10,6,30));
  assert.equal(calls.filter(x=>x.includes("/sendMessage")).length,1,"same slot deduplicated");
  await trigger(e,"30 6,18 * * *",Date.UTC(2026,10,10,18,30));
  assert.equal(calls.filter(x=>x.includes("/sendMessage")).length,2);
});
