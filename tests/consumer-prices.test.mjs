import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.mjs";
function env(){
  const map=new Map();
  return {BOT_TOKEN:"FAKE",WEBHOOK_SECRET:"test-secret",STATE:{
    async get(k){return map.get(k)??null;},
    async put(k,v){map.set(k,v);},
    async delete(k){map.delete(k);},
    async list(){return {keys:[],list_complete:true}}
  }};
}
function stub(t){
  const sent=[];const prev=globalThis.fetch;
  globalThis.fetch=async (url,opts={})=>{
    const u=String(url);
    if(u.startsWith("https://api.telegram.org/bot")){
      sent.push(JSON.parse(opts.body));
      return {ok:true,json:async()=>({ok:true,result:true})};
    }
    if(u.includes("api.coingecko.com"))return {ok:true,json:async()=>({bitcoin:{usd:50000}})};
    if(u.includes("tgju.org"))return {ok:true,text:async()=>"<html> "+("s".repeat(260))+" نرخ فعلی ۱۲٬۳۴۵٬۶۷۸ قیمت ریالی ۱٬۲۳۴٬۵۶۷ </html>"};
    throw Error("Unexpected network request "+u);
  };
  t.after(()=>{globalThis.fetch=prev;});
  return sent;
}
let updateID=15000;
async function update(e,txt,{id=111,callback=false}={}){
  const data=callback
    ? {update_id:++updateID,callback_query:{id:"cb-"+updateID,data:txt,from:{id},message:{chat:{id,type:"private"}}}}
    : {update_id:++updateID,message:{chat:{id,type:"private"},from:{id},text:txt}};
  return worker.fetch(new Request("https://test.invalid/telegram",{
    method:"POST",headers:{"Content-Type":"application/json","X-Telegram-Bot-Api-Secret-Token":"test-secret"},
    body:JSON.stringify(data)
  }),e);
}
test("Goods are listed without fabricated prices and market schedule stays separate",async t=>{
  const e=env(),sent=stub(t);
  assert.equal((await update(e,"/price")).status,200);
  assert.match(sent.at(-1).text,/گزارش قیمت بازار/);
  assert.equal(sent.at(-1).reply_markup.inline_keyboard[0][0].callback_data,"prices:goods");
  assert.equal((await update(e,"prices:goods",{callback:true})).status,200);
  const goods=sent.at(-1).text;
  for(const name of ["ساقه طلایی","نان","موز","کاندوم کدکس ۱۲ عددی"])assert.ok(goods.includes(name));
  assert.equal((goods.match(/در دسترس نیست/g)||[]).length,4);
  assert.doesNotMatch(goods,/https:\/\//);
});
test("Only the owner can enter complete SKU, fresh quote and source; stale prices do not render",async t=>{
  const e=env(),sent=stub(t);
  await update(e,"/setgood banana 90000 | موز هر کیلو | https://example.com/banana",{id:222});
  assert.match(sent.at(-1).text,/تنها برای مدیر/);
  await e.STATE.put("owner_chat_id","111");
  await update(e,"/setgood banana 90000 | موز هر کیلو | https://example.com/banana");
  assert.match(sent.at(-1).text,/ثبت شد/);
  await update(e,"/goods");
  assert.match(sent.at(-1).text,/۹۰٬۰۰۰ تومان/);
  assert.doesNotMatch(sent.at(-1).text,/example.com/);
  await update(e,"/sources");
  assert.match(sent.at(-1).text,/https:\/\/example.com\/banana/);
  await e.STATE.put("good:quote:v1:banana",JSON.stringify({toman:90000,spec:"موز هر کیلو",url:"https://example.com/banana",updatedAt:"2020-01-01T00:00:00Z"}));
  await update(e,"/goods");
  assert.doesNotMatch(sent.at(-1).text,/۹۰٬۰۰۰ تومان/);
  await update(e,"/sources");
  assert.doesNotMatch(sent.at(-1).text,/example.com\/banana/);
});
test("Malformed sources, non-owner changes and deleting quotes are handled",async t=>{
  const e=env(),sent=stub(t);
  await e.STATE.put("owner_chat_id","111");
  await update(e,"/setgood codex12 500000 | کدکس کلاسیک ۱۲ عددی | http://example.com");
  assert.match(sent.at(-1).text,/فرمت/);
  await update(e,"/setgood codex12 500000 | کدکس کلاسیک ۱۲ عددی | https://example.com/codex");
  await update(e,"/cleargood codex12",{id:222});
  assert.match(sent.at(-1).text,/تنها برای مدیر/);
  await update(e,"/cleargood codex12");
  assert.match(sent.at(-1).text,/حذف شد/);
  await update(e,"/goods");
  assert.doesNotMatch(sent.at(-1).text,/۵۰۰٬۰۰۰ تومان/);
});
