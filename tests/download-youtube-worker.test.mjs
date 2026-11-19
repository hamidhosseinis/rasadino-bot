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
test("all users get the normal menu without any download button",async t=>{
  const {sent,jobs}=network(t);const e=env();
  for(const [chat,text,n] of [[1234,"/start",101],[6789,"/start",102],[6789,"/menu",103]]){
    assert.equal((await deliver(e,chat,text,n)).status,200);
    assert.ok(!menuButtons(sent).some(x=>x.callback_data==="download:youtube"));
    assert.ok(!menuButtons(sent).some(x=>x.text?.includes("دانلود")));
  }
  assert.equal(jobs.length,0);
});

test("first message can be YouTube URL without /start, /download or a button",async t=>{
  const {sent,jobs}=network(t);const e=env();
  assert.equal((await deliver(e,6789,"https://youtu.be/dQw4w9WgXcQ?t=2",104)).status,200);
  assert.equal(jobs.length,1);
  assert.deepEqual(jobs[0],{
    url:"https://download.example.test/jobs",chat_id:"6789",
    youtube_url:"https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  });
  assert.match(sent.at(-1).payload.text,/درخواست ثبت شد/);
  assert.equal((await deliver(e,1234,"https://www.youtube.com/shorts/4M7qGbEA9tg",105)).status,200);
  assert.equal(jobs.length,2);
});

test("YouTube video links take priority over a pending music search",async t=>{
  const {sent,jobs}=network(t);const e=env();
  await e.STATE.put("music:pending:6789","file");
  assert.equal((await deliver(e,6789,"https://www.youtube.com/watch?v=dQw4w9WgXcQ",108)).status,200);
  assert.equal(jobs.length,1);
  assert.match(sent.at(-1).payload.text,/درخواست ثبت شد/);
});

test("non-YouTube links and unrelated messages do not trigger video jobs",async t=>{
  const {sent,jobs}=network(t);const e=env();
  for(const [text,n] of [
    ["https://notyoutube.org/watch?v=dQw4w9WgXcQ",110],
    ["https://youtube.com/playlist?list=xyz",111],
    ["سلام",112],["/download",113]
  ]){
    assert.equal((await deliver(e,6789,text,n)).status,200);
  }
  assert.equal(jobs.length,0);
  assert.ok(!menuButtons(sent).some(x=>x.callback_data==="download:youtube"));
});

test("missing backend never reports success or sends a video",async t=>{
  const {sent,jobs}=network(t);const e=env("1234",false);
  assert.equal((await deliver(e,8765,"https://youtu.be/dQw4w9WgXcQ",120)).status,200);
  assert.match(sent.at(-1).payload.text,/دانلود فعلاً فعال نیست/);
  assert.equal(jobs.length,0);
});

test("each user is limited to three accepted videos per UTC day",async t=>{
  const {sent,jobs}=network(t);const e=env();
  for(let i=0;i<3;i++){
    assert.equal((await deliver(e,6789,"https://youtu.be/dQw4w9WgXcQ",210+i)).status,200);
    await e.STATE.delete("download:youtube:cooldown:6789");
  }
  assert.equal(jobs.length,3);
  assert.equal((await deliver(e,6789,"https://youtu.be/dQw4w9WgXcQ",214)).status,200);
  assert.equal(jobs.length,3);
  assert.match(sent.at(-1).payload.text,/سهمیه امروز/);
  assert.equal((await deliver(e,1234,"https://youtu.be/dQw4w9WgXcQ",215)).status,200);
  assert.equal(jobs.length,4,"another user's allowance stays separate");
});

test("cooldown blocks duplicate rapid link submissions",async t=>{
  const {sent,jobs}=network(t);const e=env();
  await deliver(e,6789,"https://youtu.be/dQw4w9WgXcQ",220);
  await deliver(e,6789,"https://youtu.be/dQw4w9WgXcQ",221);
  assert.equal(jobs.length,1);
  assert.match(sent.at(-1).payload.text,/کمی بعد/);
});
