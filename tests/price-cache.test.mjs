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
  let failOil=false;
  let failPrimaryOnly=false;
  let failFredOnly=false;
  globalThis.fetch=async (url,opts={})=>{
    const target=String(url);
    calls.push(target);
    if(target.startsWith("https://api.telegram.org/bot")) {
      return {ok:true,status:200,json:async()=>({ok:true,result:true})};
    }
    if(target.includes("api.coingecko.com")) {
      return {ok:true,status:200,json:async()=>({bitcoin:{usd:100000}})};
    }
    if(target.includes("americasoilwatch.com/api/v1/brent")) {
      if(failOil||failPrimaryOnly) throw Error("Simulated AmericasOilWatch outage");
      return {ok:true,status:200,json:async()=>({
        lastUpdated:new Date().toISOString(),
        observedAt:new Date().toISOString(),
        sessionDate:new Date().toISOString().slice(0,10),
        quoteType:"intraday",quoteStatus:"current",
        provider:"Yahoo Finance (BZF27.NYM)",priceUsd:93.33,
        dataSource:"Yahoo Finance (BZF27.NYM)"
      })};
    }
    if(target.includes("fred.stlouisfed.org/graph/fredgraph.csv")) {
      if(failOil||failFredOnly) throw Error("Simulated FRED outage");
      const day=new Date(Date.now()-2*86400000).toISOString().slice(0,10);
      return {ok:true,status:200,text:async()=>(
        "observation_date,DCOILBRENTEU\n"+day+",92.14\n"+
        new Date().toISOString().slice(0,10)+",.\n")};
    }
    if(target.includes("raw.githubusercontent.com/datasets/oil-prices/")) {
      if(failOil) throw Error("Simulated GitHub public oil mirror outage");
      const day=new Date(Date.now()-86400000).toISOString().slice(0,10);
      return {ok:true,status:200,text:async()=>(
        "Date,Price\r\n"+day+",91.86\r\n")};
    }
    if(target.includes("tgju.org/profile/")) {
      if(failTgju) throw Error("Simulated TGJU outage");
      return {ok:true,status:200,text:async()=>
        "<html>نرخ فعلی ۱۲٬۳۴۵٬۶۷۸ قیمت ریالی ۱٬۲۳۴٬۵۶۷"+(" معتبر".repeat(100))+"</html>"};
    }
    throw Error("Unexpected request: "+target);
  };
  t.after(()=>{globalThis.fetch=original});
  return {calls,setTgjuFailure(value){failTgju=value;},setOilFailure(value){failOil=value;},setPrimaryFailure(value){failPrimaryOnly=value;},setFredFailure(value){failFredOnly=value;}};
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
  assert.ok(snapshot.oil.updatedAt);
  assert.equal(snapshot.oil.value,93.33);
  assert.equal(snapshot.oil.oilType,"futures");
  assert.ok(snapshot.oil.marketDate);
  assert.equal(snapshot.usd,undefined);
  assert.equal(calls.filter(x=>x.includes("api.telegram.org")).length,0);
  assert.equal(calls.filter(x=>x.includes("coingecko")).length,1);
  assert.equal(calls.filter(x=>x.includes("tgju.org/profile/")).length,2);
  assert.equal(calls.filter(x=>x.includes("americasoilwatch.com")).length,1);
  assert.equal(calls.filter(x=>x.includes("stooq.com")).length,0);
  assert.equal(calls.filter(x=>x.includes("price_dollar_rl")).length,0);
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
  assert.ok(json.quotes.oil.value>0);
  assert.equal(json.quotes.usd,undefined);
  assert.match(json.report,/نفت خام برنت/);
  assert.doesNotMatch(json.report,/دلار آزاد/);
  assert.match(json.report,/۱۳۵۷/);
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
  api.setOilFailure(true);
  const next=await refreshPriceSnapshot(e);
  assert.equal(next.btc.value,100000);
  assert.equal(next.usdt.value,initial.usdt.value);
  assert.equal(next.gold.value,initial.gold.value);
  assert.equal(next.gold.updatedAt,initial.gold.updatedAt);
  assert.equal(next.oil.value,initial.oil.value);
  assert.equal(next.oil.updatedAt,initial.oil.updatedAt);
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
    gold:{value:6000000,source:"TGJU",updatedAt:old},
    usd:{value:100000,source:"TGJU",updatedAt:old},
    oil:{value:90.5,source:"Stooq CB.F",marketDate:new Date().toISOString().slice(0,10),updatedAt:old}};
  e.STATE.data.set("prices:latest:v1",JSON.stringify(snapshot));
  const visible=await prices(e);
  assert.equal(visible.btc.value,null);
  assert.equal(visible.usdt.value,null);
  assert.equal(visible.gold.value,null);
  assert.equal(visible.oil.value,null);
  assert.equal(visible.oil.stale,true);
  assert.equal(visible.usd,undefined);
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

test("real-shaped primary global Brent API returns dated futures price",async t=>{
  const api=interceptFetch(t);
  const e=makeEnv();
  const q=await refreshPriceSnapshot(e);
  assert.equal(q.oil.value,93.33);
  assert.equal(q.oil.source,"AmericasOilWatch / Brent Futures");
  assert.equal(q.oil.oilType,"futures");
  assert.equal(q.oil.marketDate,new Date().toISOString().slice(0,10));
  assert.equal(api.calls.filter(x=>x.includes("americasoilwatch.com")).length,1);
  assert.equal(api.calls.filter(x=>x.includes("fred.stlouisfed.org")).length,0);
});
test("if live Brent feed fails, EIA/FRED returns its recent dated spot",async t=>{
  const api=interceptFetch(t);
  const e=makeEnv();
  api.setPrimaryFailure(true);
  const q=await refreshPriceSnapshot(e);
  assert.equal(q.oil.value,92.14);
  assert.equal(q.oil.source,"EIA via FRED");
  assert.equal(q.oil.oilType,"spot");
  assert.equal(q.oil.marketDate,new Date(Date.now()-2*86400000).toISOString().slice(0,10));
  assert.equal(api.calls.filter(x=>x.includes("fred.stlouisfed.org")).length,1);
});
test("a third independent CSV mirror prevents missing oil if two feeds fail",async t=>{
  const api=interceptFetch(t);
  const e=makeEnv();
  api.setPrimaryFailure(true);
  api.setFredFailure(true);
  const q=await refreshPriceSnapshot(e);
  assert.equal(q.oil.value,91.86);
  assert.equal(q.oil.source,"EIA via GitHub mirror");
  assert.equal(q.oil.oilType,"spot");
  assert.equal(api.calls.filter(x=>x.includes("raw.githubusercontent.com")).length,1);
});

test("a stale oil market date is not misrepresented as today's price",async t=>{
  const {calls}=interceptFetch(t);
  const e=makeEnv();
  const current=new Date().toISOString();
  const oldDay=new Date(Date.now()-17*86400000).toISOString().slice(0,10);
  e.STATE.data.set("prices:latest:v1",JSON.stringify({at:current,
    btc:{value:100000,source:"CoinGecko",updatedAt:current},
    gold:{value:5000000,source:"TGJU",updatedAt:current},
    usdt:{value:100000,source:"TGJU",updatedAt:current},
    usd:{value:100000,source:"TGJU",updatedAt:current},
    oil:{value:80,source:"Stooq CB.F",updatedAt:current,marketDate:oldDay}
  }));
  const snapshot=await prices(e);
  assert.equal(snapshot.oil.value,null);
  assert.equal(snapshot.oil.stale,true);
  assert.equal(snapshot.usd,undefined);
  assert.equal(calls.length,0);
});

test("saved oil quote survives short outages but visibly signals delay",async t=>{
  const {calls}=interceptFetch(t);
  const e=makeEnv();
  const now=new Date().toISOString();
  const oldUpdatedAt=new Date(Date.now()-2*3600000).toISOString();
  e.STATE.data.set("prices:latest:v1",JSON.stringify({at:now,
    btc:{value:90000,source:"CoinGecko",updatedAt:now},
    gold:{value:5000000,source:"TGJU",updatedAt:now},
    usdt:{value:100000,source:"TGJU",updatedAt:now},
    oil:{value:93.33,source:"AmericasOilWatch / Brent Futures",
      marketDate:new Date().toISOString().slice(0,10),oilType:"futures",updatedAt:oldUpdatedAt}
  }));
  const quote=await prices(e);
  assert.equal(quote.oil.value,93.33);
  assert.equal(quote.oil.delayed,true);
  assert.equal(calls.length,0);
  const response=await worker.fetch(new Request("https://example.invalid/prices"),e);
  const body=await response.json();
  assert.match(body.report,/آخرین نرخ ذخیره‌شده/);
  assert.match(body.report,/📅 تاریخ نرخ جهانی/);
});
