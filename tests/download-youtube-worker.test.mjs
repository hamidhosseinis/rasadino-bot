import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.mjs";

function env(owner="1234",withService=true) {
  const data=new Map([["owner_chat_id",owner]]);
  const STATE={
    async get(k){return data.get(k)??null;},
    async put(k,v){data.set(k,v);},
    async delete(k){data.delete(k);},
    async list(){return {keys:[],list_complete:true};}
  };
  return {
    STATE, BOT_TOKEN:"LOCAL_TEST_BOT_TOKEN",WEBHOOK_SECRET:"test-secret",
    ...(withService?{YOUTUBE_DOWNLOAD_SERVICE_URL:"https://download.example.test/jobs",YOUTUBE_DOWNLOAD_API_KEY:"test-secret-key"}:{})
  };
}
function network(t) {
  const orig=globalThis.fetch;
  const sent=[],jobs=[];
  globalThis.fetch=async(url,opts={})=>{
    const addr=String(url);
    if(addr.startsWith("https://api.telegram.org/bot")){
      const method=addr.split("/").at(-1);
      const payload=JSON.parse(opts.body||"{}");
      sent.push({method,payload});
      return {ok:true,status:200,json:async()=>({ok:true,result:true})};
    }
    if(addr==="https://download.example.test/jobs"){
      jobs.push({url:addr,...JSON.parse(opts.body)});
      assert.equal(opts.headers["X-Download-Key"],"test-secret-key");
      return {ok:true,status:202,json:async()=>({accepted:true})};
    }
    throw Error("unexpected fetch target "+addr);
  };
  t.after(()=>{globalThis.fetch=orig;});
  return {sent,jobs};
}
async function deliver(e,who,text,n,isCallback=false) {
  const update=isCallback
    ? {update_id:n,callback_query:{id:"cb"+n,data:text,from:{id:who},
        message:{message_id:99,chat:{id:who,type:"private"}}}}
    : {update_id:n,message:{chat:{id:who,type:"private"},from:{id:who},text}};
  return worker.fetch(new Request("https://worker.example.test/telegram",{
    method:"POST",
    headers:{"Content-Type":"application/json","X-Telegram-Bot-Api-Secret-Token":"test-secret"},
    body:JSON.stringify(update)
  }),e);
}
function menuButtons(sent) {
  const item=sent.filter(x=>["sendMessage","editMessageText"].includes(x.method)).at(-1);
  return item?.payload.reply_markup?.inline_keyboard.flat()||[];
}
test("only the existing owner sees the private download button",async t=>{
  const {sent,jobs}=network(t); const e=env();
  assert.equal((await deliver(e,1234,"/start",101)).status,200);
  assert.ok(menuButtons(sent).some(x=>x.callback_data==="download:youtube"));
  assert.equal((await deliver(e,6789,"/start",102)).status,200);
  assert.ok(!menuButtons(sent).some(x=>x.callback_data==="download:youtube"));
  assert.equal((await deliver(e,6789,"/download",103)).status,200);
  assert.ok(!menuButtons(sent).some(x=>x.callback_data==="download:youtube"));
  assert.equal(jobs.length,0);
});
test("owner receives prompt; invalid links never call backend; valid URLs queue file job",async t=>{
  const {sent,jobs}=network(t);const e=env();
  assert.equal((await deliver(e,1234,"download:youtube",104,true)).status,200);
  assert.match(sent.at(-1).payload.text,/لینک ویدئوی یوتیوب/);
  assert.equal((await deliver(e,1234,"https://notyoutube.org",105)).status,200);
  assert.match(sent.at(-1).payload.text,/لینک معتبر/);
  assert.equal(jobs.length,0);
  assert.equal((await deliver(e,1234,"https://youtu.be/dQw4w9WgXcQ",106)).status,200);
  assert.equal(jobs.length,1);
  assert.deepEqual(jobs[0],{url:"https://download.example.test/jobs",chat_id:"1234",youtube_url:"https://www.youtube.com/watch?v=dQw4w9WgXcQ"});
  assert.match(sent.at(-1).payload.text,/درخواست ثبت شد/);
  assert.equal((await deliver(e,1234,"https://youtu.be/dQw4w9WgXcQ",107)).status,200);
  assert.equal(jobs.length,1,"the pending state clears after accepted request");
});
test("a missing sidecar never pretends a video was downloaded",async t=>{
  const {sent,jobs}=network(t);const e=env("1234",false);
  await deliver(e,1234,"/download",108);
  assert.equal((await deliver(e,1234,"https://youtu.be/dQw4w9WgXcQ",109)).status,200);
  assert.match(sent.at(-1).payload.text,/دانلود فعلاً فعال نیست/);
  assert.equal(jobs.length,0);
});
