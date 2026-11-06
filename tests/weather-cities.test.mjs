import test from "node:test";
import assert from "node:assert/strict";
import worker, {GOLESTAN_CITIES, cityWeatherKeyboard} from "../src/worker.mjs";

const seed = () => {
  const values = new Map();
  return {
    async get(key) {return values.get(key) ?? null;},
    async put(key,value) {values.set(key,value);},
    async delete(key) {values.delete(key);},
    async list() {return {keys:[],list_complete:true};}
  };
};
const env = () => ({STATE:seed(),BOT_TOKEN:"TEST_TOKEN",WEBHOOK_SECRET:"test-secret"});
const dateNowTehran=()=>new Date(Date.now()+210*60*1000).toISOString().slice(0,16);
function stubFetch(t) {
  const original=globalThis.fetch;
  const telegram=[];
  const weather=[];
  globalThis.fetch=async (url,opts={})=>{
    const u=String(url);
    if(u.startsWith("https://api.telegram.org/bot")){
      const method=u.slice(u.lastIndexOf("/")+1);
      telegram.push({method,payload:JSON.parse(opts.body)});
      return {ok:true,status:200,json:async()=>({ok:true,result:true})};
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
    throw new Error("Unexpected network request: "+u);
  };
  t.after(()=>{globalThis.fetch=original});
  return {telegram,weather};
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
test("Golestan weather registry has 37 unique, province-bound cities",()=>{
  assert.equal(GOLESTAN_CITIES.length,37);
  assert.equal(new Set(GOLESTAN_CITIES.map(c=>c.id)).size,37);
  assert.equal(new Set(GOLESTAN_CITIES.map(c=>c.name)).size,37);
  const expected=["گرگان","کردکوی","آق‌قلا","علی‌آباد کتول","بندرگز","مراوه‌تپه",
    "گلیداغ","القجر","ینقاق","صادق‌آباد","سیجوال","قرق","دوزین","تاتار علیا"];
  for(const name of expected) assert.ok(GOLESTAN_CITIES.some(c=>c.name===name),name);
  for(const c of GOLESTAN_CITIES){
    assert.match(c.id,/^[a-z][a-z0-9]{1,23}$/);
    assert.ok(c.latitude>=36.5&&c.latitude<=38.2,c.name);
    assert.ok(c.longitude>=53.7&&c.longitude<=56.2,c.name);
  }
});
test("city choices are paginated, every city accessible, callback_data under Telegram limit",()=>{
  const choices=[],counts=[];
  for(let page=0;page<4;page++){
    const keyboard=cityWeatherKeyboard(page).inline_keyboard.flat();
    const pageCities=keyboard.filter(b=>b.callback_data.startsWith("weather:")&&!b.callback_data.includes(":page:"));
    counts.push(pageCities.length);
    choices.push(...pageCities.map(b=>b.callback_data.slice(8)));
    assert.ok(keyboard.some(b=>b.callback_data==="main:menu"));
    for(const button of keyboard)assert.ok(Buffer.byteLength(button.callback_data,"utf8")<=64);
  }
  assert.deepEqual(counts,[10,10,10,7]);
  assert.deepEqual(new Set(choices),new Set(GOLESTAN_CITIES.map(c=>c.id)));
});
test("weather button, next pages, city report and back-to-page work without changing other menu items",async t=>{
  const {telegram,weather}=stubFetch(t);
  const e=env();
  assert.equal((await update(e,"🌤 آب و هوا",1001)).status,200);
  let messages=telegram.filter(x=>x.method==="sendMessage");
  assert.match(messages.at(-1).payload.text,/۳۷ شهر/);
  assert.ok(messages.at(-1).payload.reply_markup.inline_keyboard.flat().some(x=>x.callback_data==="weather:page:1"));
  for(let page=1;page<=3;page++)assert.equal((await update(e,"weather:page:"+page,1001+page)).status,200);
  messages=telegram.filter(x=>x.method==="sendMessage");
  assert.match(messages.at(-1).payload.text,/صفحه/);
  assert.ok(messages.at(-1).payload.reply_markup.inline_keyboard.flat().some(b=>b.callback_data==="weather:sadeghabad"));
  assert.equal((await update(e,"weather:sadeghabad",1010)).status,200);
  messages=telegram.filter(x=>x.method==="sendMessage");
  assert.match(messages.at(-1).payload.text,/آب‌وهوای صادق‌آباد/);
  assert.ok(messages.at(-1).payload.reply_markup.inline_keyboard.flat().some(x=>x.callback_data==="weather:page:3"));
  assert.equal(weather.length,1);
  assert.equal(Number(weather[0].searchParams.get("latitude")),37.37556);
  assert.equal(Number(weather[0].searchParams.get("longitude")),55.67444);
  assert.equal((await update(e,"weather:gorgan",1011)).status,200);
  messages=telegram.filter(x=>x.method==="sendMessage");
  assert.ok(messages.at(-1).payload.reply_markup.inline_keyboard.flat().some(x=>x.callback_data==="weather:page:0"));
  assert.equal(weather.length,2);
});
