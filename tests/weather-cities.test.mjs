import test from "node:test";
import assert from "node:assert/strict";
import worker, {GOLESTAN_CITIES, cityWeatherKeyboard} from "../src/worker.mjs";

const seed = () => {
  const values = new Map();
  const metadata = new Map();
  return {
    async get(key) {return values.get(key) ?? null;},
    async put(key,value,options={}) {
      values.set(key,value);
      metadata.set(key,options.metadata ?? null);
    },
    async delete(key) {values.delete(key);metadata.delete(key);},
    async list({prefix="",cursor,limit=1000}={}) {
      const keys=[...values.keys()].filter(k=>k.startsWith(prefix)).sort();
      const start=Number(cursor||0);
      const items=keys.slice(start,start+limit).map(name=>({
        name,metadata:metadata.get(name)??undefined
      }));
      const list_complete=start+limit>=keys.length;
      return {keys:items,list_complete,cursor:list_complete?undefined:String(start+limit)};
    }
  };
};
const env = () => ({STATE:seed(),BOT_TOKEN:"TEST_TOKEN",WEBHOOK_SECRET:"test-secret"});
const dateNowTehran=()=>new Date(Date.now()+210*60*1000).toISOString().slice(0,16);
function stubFetch(t) {
  const original=globalThis.fetch;
  const telegram=[];
  const weather=[];
  const price=[];
  globalThis.fetch=async (url,opts={})=>{
    const u=String(url);
    if(u.startsWith("https://api.telegram.org/bot")){
      const method=u.slice(u.lastIndexOf("/")+1);
      telegram.push({method,payload:JSON.parse(opts.body)});
      const result=method==="getWebhookInfo"
        ? {url:"https://example.invalid/telegram",allowed_updates:["message","callback_query"]}
        : true;
      return {ok:true,status:200,json:async()=>({ok:true,result})};
    }
    if(u.startsWith("https://api.open-meteo.com/v1/forecast")){
      weather.push(new URL(u));
      const time=dateNowTehran();
      return {ok:true,status:200,json:async()=>({
        timezone:"Asia/Tehran",
        current:{time,temperature_2m:18,apparent_temperature:17,relative_humidity_2m:65,
                 weather_code:2,wind_speed_10m:9},
        daily:{time:["2026-11-06","2026-11-07"],weather_code:[2,3],
               temperature_2m_min:[12,11],temperature_2m_max:[19,20],
               precipitation_probability_max:[30,20],precipitation_sum:[0,0]}
      })};
    }
    if(u.includes("api.coingecko.com")){
      price.push("coingecko");
      return {ok:true,status:200,json:async()=>({bitcoin:{usd:68000}})};
    }
    if(u.includes("tgju.org/profile/")){
      price.push("tgju");
      const html="<html><body>نرخ فعلی ۱۲٬۳۴۵٬۶۷۸ قیمت ریالی ۱٬۲۳۴٬۵۶۷"+(" نمونه".repeat(100))+"</body></html>";
      return {ok:true,status:200,text:async()=>html};
    }
    throw new Error("Unexpected network request: "+u);
  };
  t.after(()=>{globalThis.fetch=original});
  return {telegram,weather,price};
}
async function update(e,data,n) {
  const chatId=78901;
  const body=data.startsWith("weather:")||data==="main:menu"
    ? {update_id:n,callback_query:{id:"cb-"+n,data,from:{id:chatId},message:{chat:{id:chatId,type:"private"}}}}
    : {update_id:n,message:{chat:{id:chatId,type:"private"},from:{id:chatId},text:data}};
  return worker.fetch(new Request("https://example.invalid/telegram",{
    method:"POST",headers:{"Content-Type":"application/json","X-Telegram-Bot-Api-Secret-Token":"test-secret"},
    body:JSON.stringify(body)
  }),e);
}
function lastSent(telegram) {
  return telegram.filter(x=>x.method==="sendMessage").at(-1).payload;
}
test("Only the six selected Golestan cities remain, with unique IDs and valid coordinates",()=>{
  assert.deepEqual(GOLESTAN_CITIES.map(c=>c.name),[
    "بندرگز","کردکوی","گرگان","آق‌قلا","علی‌آباد کتول","گنبدکاووس"
  ]);
  assert.deepEqual(GOLESTAN_CITIES.map(c=>c.id),[
    "bandargaz","kordkuy","gorgan","aqqala","aliabad","gonbad"
  ]);
  assert.equal(new Set(GOLESTAN_CITIES.map(c=>c.id)).size,6);
  for(const c of GOLESTAN_CITIES){
    assert.match(c.id,/^[a-z][a-z0-9]{1,23}$/);
    assert.ok(c.latitude>=36.5&&c.latitude<=38.2,c.name);
    assert.ok(c.longitude>=53.7&&c.longitude<=56.2,c.name);
  }
});
test("Weather has exactly three two-city rows, main menu and no page controls",()=>{
  const rows=cityWeatherKeyboard().inline_keyboard;
  assert.deepEqual(rows.map(r=>r.length),[2,2,2,1]);
  assert.deepEqual(rows.slice(0,3).flat().map(b=>b.callback_data),GOLESTAN_CITIES.map(c=>"weather:"+c.id));
  assert.equal(rows.at(-1)[0].callback_data,"main:menu");
  for(const button of rows.flat())assert.ok(Buffer.byteLength(button.callback_data,"utf8")<=64);
  assert.ok(!rows.flat().some(b=>b.callback_data.includes("weather:page:")));
});
test("Weather menu and both edge cities work; retired menu buttons lead to six-city menu",async t=>{
  const {telegram,weather}=stubFetch(t);
  const e=env();
  assert.equal((await update(e,"🌤 آب و هوا",1001)).status,200);
  assert.match(lastSent(telegram).text,/۶ شهر/);
  assert.equal(lastSent(telegram).reply_markup.inline_keyboard.length,4);
  assert.doesNotMatch(lastSent(telegram).text,/Open-Meteo|منبع/);
  assert.equal((await update(e,"weather:bandargaz",1002)).status,200);
  assert.match(lastSent(telegram).text,/آب‌وهوای بندرگز/);
  assert.doesNotMatch(lastSent(telegram).text,/Open-Meteo|منبع/);
  assert.ok(lastSent(telegram).reply_markup.inline_keyboard.flat().some(x=>x.callback_data==="weather:menu"));
  assert.equal(Number(weather.at(-1).searchParams.get("longitude")),53.9481);
  assert.equal((await update(e,"weather:gonbad",1003)).status,200);
  assert.match(lastSent(telegram).text,/آب‌وهوای گنبدکاووس/);
  assert.equal(Number(weather.at(-1).searchParams.get("latitude")),37.2493);
  assert.equal(weather.length,2);
  assert.equal((await update(e,"weather:gonbad",1004)).status,200);
  assert.equal(weather.length,2,"second lookup must use city-specific KV cache");
  assert.equal((await update(e,"weather:page:3",1005)).status,200);
  assert.match(lastSent(telegram).text,/۶ شهر/);
  assert.equal((await update(e,"weather:sadeghabad",1006)).status,200);
  assert.match(lastSent(telegram).text,/۶ شهر/);
  assert.equal((await update(e,"weather:menu",1007)).status,200);
  assert.deepEqual(lastSent(telegram).reply_markup.inline_keyboard,cityWeatherKeyboard().inline_keyboard);
});
test("Sources button explains all current price and weather sources, without fetching data",async t=>{
  const {telegram,weather,price}=stubFetch(t);
  const e=env();
  assert.equal((await update(e,"/start",1100)).status,200);
  assert.ok(lastSent(telegram).reply_markup.keyboard.flat().some(b=>b.text==="📚 منابع"));
  assert.equal((await update(e,"📚 منابع",1101)).status,200);
  const msg=lastSent(telegram);
  assert.match(msg.text,/📚 منابع اطلاعات رصدینو/);
  for(const link of [
    "https://open-meteo.com/","https://www.coingecko.com/en/coins/bitcoin",
    "https://www.coinbase.com/price/bitcoin",
    "https://www.tgju.org/profile/geram18","https://www.tgju.org/profile/crypto-tether"
  ])assert.ok(msg.text.includes(link),link);
  assert.match(msg.text,/جایگزین/);
  assert.match(msg.text,/۶ شهر/);
  assert.equal(weather.length,0);
  assert.equal(price.length,0);
  assert.equal((await update(e,"/sources",1102)).status,200);
  assert.equal(lastSent(telegram).text,msg.text);
  assert.equal((await update(e,"/help",1103)).status,200);
  assert.match(lastSent(telegram).text,/\/sources/);
});
test("Manual and scheduled price reports omit provider names and URLs",async t=>{
  const {telegram,price}=stubFetch(t);
  const e=env();
  assert.equal((await update(e,"/price",1200)).status,200);
  let message=lastSent(telegram).text;
  assert.match(message,/گزارش قیمت بازار/);
  assert.match(message,/بیت‌کوین/);
  assert.doesNotMatch(message,/CoinGecko|Coinbase|TGJU|tgju\.org|منابع:/);
  assert.equal(price.length,3);
  assert.equal((await update(e,"/start",1201)).status,200);
  assert.equal((await update(e,"/subscribe",1202)).status,200);
  const scheduled=[];
  await worker.scheduled({cron:"30 6,18 * * *",scheduledTime:Date.parse("2026-11-07T06:30:00Z")},e,
    {waitUntil(task){scheduled.push(task)}});
  await Promise.all(scheduled);
  message=lastSent(telegram).text;
  assert.match(message,/گزارش قیمت بازار/);
  assert.doesNotMatch(message,/CoinGecko|Coinbase|TGJU|open-meteo|منابع:/);
});
