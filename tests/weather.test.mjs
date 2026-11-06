import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.mjs";

const HOUR=3600000, TEHRAN_OFFSET=210*60000;
function localHour(ms) {
  const f=new Intl.DateTimeFormat("en-US",{
    timeZone:"Asia/Tehran",year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",hourCycle:"h23"
  });
  const p=Object.fromEntries(f.formatToParts(new Date(ms)).map(x=>[x.type,x.value]));
  return p.year+"-"+p.month+"-"+p.day+"T"+p.hour+":"+p.minute;
}
function fixture({hourly=true,stale=false,rain=true}={}) {
  const now=Date.now();
  const begin=Math.floor((now+TEHRAN_OFFSET)/HOUR)*HOUR-TEHRAN_OFFSET;
  const stamp=localHour(begin-(stale?9*HOUR:0));
  const current={
    time:stamp,temperature_2m:22,apparent_temperature:21,
    relative_humidity_2m:75,weather_code:2,wind_speed_10m:9
  };
  const daily={
    time:[localHour(begin).slice(0,10),localHour(begin+24*HOUR).slice(0,10)],
    temperature_2m_min:[12,11],temperature_2m_max:[24,23],
    weather_code:[2,61],precipitation_probability_max:[70,80],
    precipitation_sum:[2,5],wind_gusts_10m_max:[15,17]
  };
  const result={timezone:"Asia/Tehran",current,daily};
  if(hourly) result.hourly={
    time:Array.from({length:48},(_,i)=>localHour(begin+i*HOUR)),
    temperature_2m:Array.from({length:48},(_,i)=>22-i%10),
    weather_code:Array.from({length:48},(_,i)=>rain&&i===2?61:2),
    precipitation_probability:Array.from({length:48},(_,i)=>rain&&i===2?75:10),
    precipitation:Array.from({length:48},(_,i)=>rain&&i===2?1.4:0)
  };
  return result;
}
function fakeEnv(){
  const kv=new Map();
  return {
    BOT_TOKEN:"FAKE_TEST_BOT_TOKEN",WEBHOOK_SECRET:"TEST_WEBHOOK_SECRET",
    STATE:{
      async get(k){return kv.get(k)??null;},
      async put(k,v){kv.set(k,v);},
      async list(){return {keys:[],list_complete:true};}
    }
  };
}
function mockFetch(t,data){
  const original=globalThis.fetch;
  const telegram=[],weatherUrls=[];
  globalThis.fetch=async (url,options={})=>{
    const str=String(url);
    if(str.startsWith("https://api.telegram.org/bot")){
      telegram.push({method:str.split("/").at(-1),data:JSON.parse(options.body)});
      return {ok:true,status:200,json:async()=>({ok:true,result:true})};
    }
    if(str.startsWith("https://api.open-meteo.com/v1/forecast?")){
      weatherUrls.push(str);
      return {ok:true,status:200,json:async()=>structuredClone(data)};
    }
    throw Error("Unexpected network request "+str);
  };
  t.after(()=>{globalThis.fetch=original;});
  return {telegram,weatherUrls};
}
async function choose(e,data,updateId){
  const chatId=90000+updateId;
  const request=new Request("https://example.invalid/telegram",{
    method:"POST",
    headers:{"Content-Type":"application/json","X-Telegram-Bot-Api-Secret-Token":"TEST_WEBHOOK_SECRET"},
    body:JSON.stringify({
      update_id:updateId,callback_query:{
        id:"weather-test-"+updateId,data,from:{id:chatId},
        message:{chat:{id:chatId,type:"private"}}
      }
    })
  });
  const response=await worker.fetch(request,e);
  assert.equal(response.status,200);
}
test("current and daily summary includes a model-based 12-hour precipitation outlook",async t=>{
  const net=mockFetch(t,fixture());
  const e=fakeEnv();
  await choose(e,"weather:gorgan",101);
  const m=net.telegram.find(x=>x.method==="sendMessage");
  assert.ok(m,"Telegram weather message is sent");
  assert.match(m.data.text,/آب‌وهوای گرگان/);
  assert.match(m.data.text,/امروز/);
  assert.match(m.data.text,/فردا/);
  assert.match(m.data.text,/۱۲ ساعت آینده/);
  assert.match(m.data.text,/اولین ساعت با احتمال بالاتر بارش/);
  assert.match(m.data.text,/Open-Meteo/);
  assert.match(m.data.text,/نه داده اختصاصی Google Weather/);
  assert.ok(m.data.reply_markup.inline_keyboard.flat().some(b=>b.callback_data==="weather:hourly:gorgan"));
  const req=new URL(net.weatherUrls[0]);
  assert.equal(req.searchParams.get("models"),"best_match");
  assert.match(req.searchParams.get("hourly"),/precipitation_probability/);
  assert.equal(req.searchParams.get("timezone"),"Asia/Tehran");
});
test("hourly detail shows local hours without pretending radar nowcasting",async t=>{
  const net=mockFetch(t,fixture());
  const e=fakeEnv();
  await choose(e,"weather:hourly:kordkuy",201);
  const message=net.telegram.find(x=>x.method==="sendMessage").data;
  assert.match(message.text,/پیش‌بینی ساعتی کردکوی/);
  assert.match(message.text,/رادار بارش لحظه‌ای/);
  assert.equal((message.text.match(/احتمال بارش/g)||[]).length,12);
  assert.ok(message.reply_markup.inline_keyboard.flat().some(b=>b.callback_data==="weather:kordkuy"));
});
test("missing hourly feed degrades gracefully and never invents a probability",async t=>{
  const net=mockFetch(t,fixture({hourly:false}));
  const e=fakeEnv();
  await choose(e,"weather:aliabad",301);
  const summary=net.telegram.find(x=>x.method==="sendMessage").data.text;
  assert.match(summary,/پیش‌بینی ساعتی بارش فعلاً در دسترس نیست/);
  assert.match(summary,/امروز/);
  await choose(e,"weather:hourly:aliabad",302);
  assert.match(net.telegram.filter(x=>x.method==="sendMessage").at(-1).data.text,/فعلاً در دسترس نیست/);
  assert.equal(net.weatherUrls.length,1,"same-city cache prevents duplicate forecast calls");
});
test("stale current conditions are not presented as live conditions",async t=>{
  const net=mockFetch(t,fixture({stale:true}));
  await choose(fakeEnv(),"weather:aqqala",401);
  assert.match(net.telegram.find(x=>x.method==="sendMessage").data.text,/اطلاعات به‌روز.*در دسترس نیست/);
});
test("dry forecast avoids falsely announcing an imminent rain start",async t=>{
  const net=mockFetch(t,fixture({rain:false}));
  await choose(fakeEnv(),"weather:gorgan",501);
  const message=net.telegram.find(x=>x.method==="sendMessage").data.text;
  assert.match(message,/۱۲ ساعت آینده/);
  assert.doesNotMatch(message,/اولین ساعت با احتمال بالاتر بارش/);
});
