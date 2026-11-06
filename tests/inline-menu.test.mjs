import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.mjs";

function state(seed={}) {
  const values=new Map(Object.entries(seed));
  const metadata=new Map();
  return {
    values,metadata,
    async get(key){return values.get(key)??null;},
    async put(key,value,opts={}) {values.set(key,value);metadata.set(key,opts.metadata??null);},
    async list({prefix="",cursor,limit=1000}={}) {
      const keys=[...values.keys()].filter(k=>k.startsWith(prefix)).sort();
      const offset=Number(cursor||0);
      return {
        keys:keys.slice(offset,offset+limit).map(name=>({name,metadata:metadata.get(name)??undefined})),
        list_complete:offset+limit>=keys.length,
        cursor:offset+limit>=keys.length?undefined:String(offset+limit)
      };
    }
  };
}
function env(seed={}) {
  return {STATE:state(seed),BOT_TOKEN:"TEST_ONLY_TOKEN",WEBHOOK_SECRET:"secret-for-tests"};
}
function telegramStub(t) {
  const original=globalThis.fetch;
  const calls=[];
  const external=[];
  globalThis.fetch=async (url,opts={})=>{
    const target=String(url);
    if(target.startsWith("https://api.telegram.org/bot")){
      const method=target.slice(target.lastIndexOf("/")+1);
      const payload=JSON.parse(opts.body);
      calls.push({method,payload});
      return {ok:true,status:200,json:async()=>({ok:true,result:true})};
    }
    external.push(target);
    if(target.includes("api.coingecko.com"))
      return {ok:true,status:200,json:async()=>({bitcoin:{usd:69000}})};
    if(target.includes("tgju.org/profile/"))
      return {ok:true,status:200,text:async()=>"<html>نرخ فعلی ۱۲٬۳۴۵٬۶۷۸ قیمت ریالی ۱٬۲۳۴٬۵۶۷"+(" معتبر".repeat(100))+"</html>"};
    if(target.includes("api.open-meteo.com/")){
      const current=new Date(Date.now()+3.5*3600*1000).toISOString().slice(0,16);
      return {ok:true,status:200,json:async()=>({
        timezone:"Asia/Tehran",
        current:{time:current,temperature_2m:15,apparent_temperature:14,relative_humidity_2m:55,
          weather_code:1,wind_speed_10m:12},
        daily:{time:["2026-11-06","2026-11-07"],weather_code:[1,2],
          temperature_2m_min:[10,11],temperature_2m_max:[21,22],
          precipitation_probability_max:[30,40],precipitation_sum:[0,0]}
      })};
    }
    throw Error("Unexpected request to "+target);
  };
  t.after(()=>{globalThis.fetch=original});
  return {calls,external};
}
async function deliver(e,update) {
  return worker.fetch(new Request("https://example.invalid/telegram",{
    method:"POST",
    headers:{"Content-Type":"application/json","X-Telegram-Bot-Api-Secret-Token":"secret-for-tests"},
    body:JSON.stringify(update)
  }),e);
}
function message(chatId,text,n) {
  return {update_id:n,message:{chat:{id:chatId,type:"private"},from:{id:chatId},text}};
}
function callback(chatId,data,n,{sender=chatId,messageId=77}={}) {
  return {update_id:n,callback_query:{id:"cb-"+n,data,from:{id:sender},
    message:{message_id:messageId,chat:{id:chatId,type:"private"}}}};
}
const last=(calls,method)=>calls.filter(c=>c.method===method).at(-1)?.payload;

test("new /start shows inline only, not persistent ReplyKeyboard; /menu reopens it",async t=>{
  const {calls}=telegramStub(t);
  const e=env();
  assert.equal((await deliver(e,message(991,"/start",100))).status,200);
  assert.equal(calls.filter(c=>c.method==="sendMessage").length,1);
  assert.ok(last(calls,"sendMessage").reply_markup.inline_keyboard.flat().some(b=>b.callback_data==="price:menu"));
  assert.ok(last(calls,"sendMessage").reply_markup.inline_keyboard.flat().some(b=>b.callback_data==="menu:close"));
  assert.equal(last(calls,"sendMessage").reply_markup.keyboard,undefined);
  assert.equal((await deliver(e,message(991,"/menu",101))).status,200);
  assert.equal(calls.filter(c=>c.payload?.reply_markup?.remove_keyboard).length,0);
  assert.equal(JSON.parse(await e.STATE.get("user:991")).ui_version,2);
});
test("a legacy user receives ReplyKeyboardRemove exactly once, without losing notifications",async t=>{
  const {calls}=telegramStub(t);
  const legacy={notifications_enabled:true,created_at:"2026-11-05T20:00:00.000Z"};
  const e=env({"user:992":JSON.stringify(legacy)});
  await deliver(e,message(992,"/menu",200));
  assert.equal(calls.filter(c=>c.payload?.reply_markup?.remove_keyboard).length,1);
  const updated=JSON.parse(await e.STATE.get("user:992"));
  assert.equal(updated.ui_version,2);
  assert.equal(updated.notifications_enabled,true);
  assert.equal(e.STATE.metadata.get("user:992").notifications_enabled,true);
  await deliver(e,message(992,"/menu",201));
  assert.equal(calls.filter(c=>c.payload?.reply_markup?.remove_keyboard).length,1);
});
test("root, submenus, close, sources and support edit a single callback message",async t=>{
  const {calls,external}=telegramStub(t);
  const e=env();
  await deliver(e,message(993,"/start",300));
  for(const [data,n] of [["price:menu",301],["main:menu",302],["sources:show",303],
                         ["support:show",304],["menu:close",305],["main:menu",306]]){
    assert.equal((await deliver(e,callback(993,data,n))).status,200,data);
    assert.equal(last(calls,"editMessageText").message_id,77);
    assert.equal(last(calls,"answerCallbackQuery").callback_query_id,"cb-"+n);
  }
  const edits=calls.filter(c=>c.method==="editMessageText");
  assert.equal(edits.length,6);
  assert.equal(calls.filter(c=>c.method==="sendMessage").length,1);
  assert.match(edits[2].payload.text,/منابع اطلاعات/);
  assert.ok(edits[3].payload.reply_markup.inline_keyboard.some(row=>row.some(b=>b.url?.includes("hamidhosseinis"))));
  assert.deepEqual(edits[4].payload.reply_markup.inline_keyboard,[]);
  assert.deepEqual(external,[]);
});
test("all price options display only chosen asset or full report; refresh uses price providers",async t=>{
  const {calls,external}=telegramStub(t);
  const e=env();
  for(const [data,n,keyword] of [["price:btc",400,"بیت‌کوین"],["price:usdt",401,"تتر"],
    ["price:gold",402,"طلا"],["price:all",403,"گزارش قیمت بازار"],
    ["price:refresh",404,"گزارش قیمت بازار"]]){
    assert.equal((await deliver(e,callback(994,data,n))).status,200,data);
    assert.match(last(calls,"editMessageText").text,new RegExp(keyword));
    assert.ok(last(calls,"editMessageText").reply_markup.inline_keyboard.flat().some(b=>b.callback_data==="price:menu"));
  }
  assert.ok(external.some(s=>s.includes("coingecko")));
  assert.ok(external.some(s=>s.includes("tgju.org")));
});
test("city choice edits forecast and keeps return navigation; callback from another user is denied",async t=>{
  const {calls,external}=telegramStub(t);
  const e=env();
  assert.equal((await deliver(e,callback(995,"weather:menu",500))).status,200);
  assert.equal(last(calls,"editMessageText").reply_markup.inline_keyboard.length,4);
  assert.equal((await deliver(e,callback(995,"weather:kordkuy",501))).status,200);
  assert.match(last(calls,"editMessageText").text,/آب‌وهوای کردکوی/);
  assert.ok(last(calls,"editMessageText").reply_markup.inline_keyboard.flat().some(b=>b.callback_data==="weather:menu"));
  assert.equal(external.filter(s=>s.includes("open-meteo")).length,1);
  const previousEdits=calls.filter(c=>c.method==="editMessageText").length;
  await deliver(e,callback(995,"menu:close",502,{sender:996}));
  assert.equal(last(calls,"answerCallbackQuery").show_alert,true);
  assert.equal(calls.filter(c=>c.method==="editMessageText").length,previousEdits);
});
test("news page, detail and back edit same message and preserve source link",async t=>{
  const {calls,external}=telegramStub(t);
  const time=new Date().toISOString();
  const id=Date.parse(time).toString(36);
  const items=Array.from({length:6},(_,i)=>({
    title:"خبر آزمایشی "+(i+1)+" گلستان",date:time,source:"منبع آزمون",
    url:"https://example.com/news/"+i,county:"گلستان"
  }));
  const e=env({["news:view:"+id]:JSON.stringify({updatedAt:time,items})});
  assert.equal((await deliver(e,callback(996,"news:view:"+id+":0",600))).status,200);
  assert.match(last(calls,"editMessageText").text,/اخبار استان گلستان/);
  assert.ok(last(calls,"editMessageText").reply_markup.inline_keyboard.flat().some(b=>b.callback_data==="news:view:"+id+":1"));
  assert.equal((await deliver(e,callback(996,"news:view:"+id+":1",601))).status,200);
  assert.match(last(calls,"editMessageText").text,/صفحه دوم/);
  assert.equal((await deliver(e,callback(996,"news:detail:"+id+":6",602))).status,200);
  const detail=last(calls,"editMessageText");
  assert.match(detail.text,/منبع آزمون/);
  assert.ok(detail.reply_markup.inline_keyboard.flat().some(b=>b.url==="https://example.com/news/5"));
  assert.equal(detail.message_id,77);
  assert.deepEqual(external,[]);
});
