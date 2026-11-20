import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.mjs";
import {parseAmount,checkJalaliDate,parseFinanceEntry,isFinanceMessage,configured} from "../src/finance/finance.mjs";

test("finance amount parser handles Persian numerals, scale, rial and invalid values",()=>{
  assert.equal(parseAmount("۲۵۰ هزار تومان"),250000);
  assert.equal(parseAmount("۳٫۵ میلیون"),3500000);
  assert.equal(parseAmount("۱٬۰۰۰٬۰۰۰ ریال"),100000);
  assert.equal(parseAmount("-5 تومان"),null);
  assert.equal(parseAmount("0"),null);
});
test("Persian calendar date is validated, never guessed",()=>{
  const valid=checkJalaliDate("۱۴۰۵/۰۹/۱۵");
  assert.equal(valid?.jalali,"۱۴۰۵/۰۹/۱۵");
  assert.match(valid?.gregorian||"",/^\d{4}-\d{2}-\d{2}$/);
  assert.equal(checkJalaliDate("۱۴۰۵/۱۲/۳۱"),null);
  assert.equal(checkJalaliDate("۱۴۰۵/۱۳/۰۱"),null);
});
test("structured finance rows and plain expenses",()=>{
  const now=new Date("2026-11-20T11:00:00Z");
  const expense=parseFinanceEntry("هزینه ۲۵۰ هزار تومان بنزین",now);
  assert.equal(expense?.action,"append_expense");
  assert.equal(expense?.data.amount,250000);
  assert.equal(expense?.data.category,"حمل‌ونقل و سوخت");
  assert.equal(expense?.data.month,"۱۴۰۵/۰۸");
  const debt=parseFinanceEntry("وام | بانک ملت | ۵۰ میلیون | ۳ میلیون | ۱۴۰۵/۰۹/۱۵ | خودرو",now);
  assert.equal(debt?.action,"append_debt");
  assert.equal(debt?.data.principal,50000000);
  const check=parseFinanceEntry("چک | صادره | ۱۴۰۵/۰۹/۱۵ | ۱۰ میلیون | حسن | 1234",now);
  assert.equal(check?.action,"append_check");
  assert.equal(check?.data.amount,10000000);
  assert.equal(parseFinanceEntry("چک | صادره | ۱۴۰۵/۱۳/۱۵ | ۱۰ میلیون | حسن"),null);
  assert.equal(isFinanceMessage("اسم آهنگ جدید"),false);
  assert.equal(configured({FINANCE_API_URL:"https://example.com/a",FINANCE_API_TOKEN:"x".repeat(40)}),false);
});
function state(seed={}){
  const map=new Map(Object.entries(seed));
  return {async get(k){return map.get(k)??null;},async put(k,v){map.set(k,v);},
    async delete(k){map.delete(k);},async list(){return {keys:[],list_complete:true};}};
}
function setup(t){
  const original=globalThis.fetch, requests=[];
  globalThis.fetch=async (url,opt={})=>{
    const target=String(url);
    if(target.includes("script.google.com")){
      requests.push({type:"finance",payload:JSON.parse(opt.body)});
      return {ok:true,json:async()=>({ok:true,saved:true})};
    }
    if(target.startsWith("https://api.telegram.org/")){
      const method=target.split("/").at(-1),payload=JSON.parse(opt.body||"{}");
      requests.push({type:method,payload});
      return {ok:true,json:async()=>({ok:true,result:true})};
    }
    throw Error("unexpected external request");
  };
  t.after(()=>{globalThis.fetch=original;});
  const e={BOT_TOKEN:"test",WEBHOOK_SECRET:"wh",STATE:state({owner_chat_id:"100"}),
    FINANCE_API_URL:"https://script.google.com/macros/s/Example123/exec",
    FINANCE_API_TOKEN:"a".repeat(40)};
  return {e,requests};
}
async function sendMessage(e,chatId,text,id){
  return worker.fetch(new Request("https://worker.test/telegram",{
    method:"POST",headers:{"X-Telegram-Bot-Api-Secret-Token":"wh"},
    body:JSON.stringify({update_id:id,message:{chat:{id:chatId,type:"private"},text}})
  }),e);
}
test("only linked owner can enter finance; public cannot write to private Google Sheet",async t=>{
  const {e,requests}=setup(t);
  assert.equal((await sendMessage(e,101,"هزینه ۱۰۰۰۰ بنزین",700)).status,200);
  assert.equal(requests.filter(x=>x.type==="finance").length,0);
  assert.equal((await sendMessage(e,101,"/finance",701)).status,200);
  assert.equal(requests.filter(x=>x.type==="finance").length,0);
  assert.equal((await sendMessage(e,100,"هزینه ۲۵۰ هزار تومان بنزین",702)).status,200);
  const writes=requests.filter(x=>x.type==="finance");
  assert.equal(writes.length,1);
  assert.equal(writes[0].payload.action,"append_expense");
  assert.equal(writes[0].payload.id,"tg:702");
  assert.equal(writes[0].payload.data.amount,250000);
  assert.equal((await sendMessage(e,100,"/finance",703)).status,200);
  assert.equal(requests.filter(x=>x.type==="sendMessage").at(-1).payload.reply_markup.inline_keyboard.length,4);
});
