import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.mjs";
import {validAudioQuery,normalizeCommonsFile,findAudioFiles,confidentAudioMatch,audioChoicesView} from "../src/music/audio.mjs";

const audioPage=(name="Fur Elise - Beethoven.mp3",license="CC0",url="https://upload.wikimedia.org/wikipedia/commons/1/11/Fur_Elise_-_Beethoven.mp3")=>({
  title:"File:"+name,
  imageinfo:[{url,size:850000,mime:"audio/mpeg",
    extmetadata:{LicenseShortName:{value:license},LicenseUrl:{value:"https://creativecommons.org/publicdomain/zero/1.0/"}}}]
});
const searchResult=(pages)=>({query:{pages}});
const ok=(data)=>({ok:true,status:200,headers:{get:()=>null},json:async()=>data});
function KV() {
  const records=new Map();
  return {
    records,async get(key){return records.get(key)??null;},
    async put(key,value){records.set(key,value);},
    async delete(key){records.delete(key);},
    async list(){return {keys:[],list_complete:true};}
  };
}
function telegramStub(t,pages) {
  const old=globalThis.fetch,calls=[];
  globalThis.fetch=async (url,opts={})=>{
    const address=new URL(String(url));
    if(address.hostname==="api.telegram.org"){
      const method=address.pathname.split("/").at(-1);
      const data=JSON.parse(opts.body);
      calls.push({method,data});
      return ok({ok:true,result:method==="sendAudio"?{audio:{file_id:"FAKE_ID"}}:true});
    }
    if(address.hostname==="commons.wikimedia.org"){
      calls.push({method:"commons",query:address.searchParams.get("gsrsearch")});
      return ok(searchResult(pages));
    }
    throw Error("Unexpected network: "+address.hostname);
  };
  t.after(()=>{globalThis.fetch=old;});
  return calls;
}
const post=(env,update)=>worker.fetch(new Request("https://rasadino.test/telegram",{
  method:"POST",headers:{"Content-Type":"application/json","X-Telegram-Bot-Api-Secret-Token":env.WEBHOOK_SECRET},
  body:JSON.stringify(update)
}),env);
const message=(id,text,n=1)=>({update_id:n,message:{chat:{type:"private",id},from:{id},text}});
const callback=(id,data,n=1,actor=id)=>({update_id:n,callback_query:{
  id:"audio-"+n,data,from:{id:actor},message:{message_id:11,chat:{id,type:"private"}}
}});

test("reject invalid input, hostile hosts, large or unlicensed files",()=>{
  assert.equal(validAudioQuery("??"),null);
  assert.equal(validAudioQuery("  گوگوش  من اومدم "), "گوگوش من اومدم");
  assert.equal(normalizeCommonsFile(audioPage("Hello.mp3","CC BY")),null);
  assert.equal(normalizeCommonsFile({...audioPage(),imageinfo:[{...audioPage().imageinfo[0],size:60*1024*1024}]}),null);
  assert.equal(normalizeCommonsFile(audioPage("Bad.mp3","CC0","https://upload.wikimedia.org.evil.example/file.mp3")),null);
  assert.equal(normalizeCommonsFile(audioPage("Bad.ogg")),null);
  assert.ok(normalizeCommonsFile(audioPage()));
});

test("fuzzy correction uses real CC0 results without fabricating songs",async()=>{
  const calls=[];
  const fetcher=async url=>{calls.push(String(url));return ok(searchResult([
    audioPage(),audioPage("Fake.mp3","CC BY"),
  ]));};
  const r=await findAudioFiles("Fur Elis",{fetcher});
  assert.equal(r.status,"ok");
  assert.equal(r.files.length,1);
  assert.ok(confidentAudioMatch(r.files));
  assert.equal(r.files[0].license,"CC0");
  const view=audioChoicesView(r.files);
  assert.equal(view.keyboard.inline_keyboard.flat().some(b=>"url" in b),false);
  assert.ok(calls[0].startsWith("https://commons.wikimedia.org/w/api.php?"));
  const bad=await findAudioFiles("Random Stranger",{fetcher});
  assert.equal(bad.status,"empty");
});

test("real Worker sends only an MP3 file, never external media links",async t=>{
  const calls=telegramStub(t,[audioPage()]);
  const state=KV(),env={STATE:state,BOT_TOKEN:"TEST_BOT",WEBHOOK_SECRET:"TEST_SECRET"};
  assert.equal((await post(env,message(51001,"/music",1))).status,200);
  assert.equal(state.records.get("music:pending:51001"),"file");
  assert.equal((await post(env,message(51001,"Fur Elis",2))).status,200);
  const audio=calls.filter(c=>c.method==="sendAudio");
  assert.equal(audio.length,1);
  assert.match(audio[0].data.audio,/^https:\/\/upload\.wikimedia\.org\//);
  assert.equal(calls.filter(c=>c.method==="sendMessage").some(c=>JSON.stringify(c.data).includes("https://")),false);
  assert.equal(calls.filter(c=>c.method==="commons").length,1);
  assert.equal(state.records.get("music:pending:51001"),"file");
  assert.ok([...state.records.keys()].some(x=>x.startsWith("music:fileid:v1:")));
});

test("ambiguous matches need user confirmation and cannot be hijacked",async t=>{
  const calls=telegramStub(t,[
    audioPage("Moonlight Sonata Performance 1.mp3","CC0","https://upload.wikimedia.org/wikipedia/commons/1/11/Moonlight_Sonata_Performance_1.mp3"),
    audioPage("Moonlight Sonata Performance 2.mp3","CC0","https://upload.wikimedia.org/wikipedia/commons/1/11/Moonlight_Sonata_Performance_2.mp3")
  ]);
  const state=KV(),env={STATE:state,BOT_TOKEN:"TEST_BOT",WEBHOOK_SECRET:"TEST_SECRET"};
  await post(env,message(51002,"/findmusic Moonlight Sonata",1));
  assert.equal(calls.filter(c=>c.method==="sendAudio").length,0);
  assert.ok(state.records.has("music:choices:51002"));
  assert.equal(calls.filter(c=>c.method==="sendMessage").some(c=>JSON.stringify(c.data).includes("https://")),false);
  await post(env,callback(51002,"music:pick:0",2,51003));
  assert.equal(calls.filter(c=>c.method==="sendAudio").length,0);
  await post(env,callback(51002,"music:pick:0",3));
  assert.equal(calls.filter(c=>c.method==="sendAudio").length,1);
  assert.equal(state.records.has("music:choices:51002"),false);
  await post(env,callback(51002,"music:pick:0",4));
  assert.equal(calls.filter(c=>c.method==="sendAudio").length,1);
});

test("missing authorized file never emits a link or copyrighted lookup result",async t=>{
  const calls=telegramStub(t,[audioPage("Hello.mp3","CC BY")]);
  const state=KV(),env={STATE:state,BOT_TOKEN:"TEST_BOT",WEBHOOK_SECRET:"TEST_SECRET"};
  await post(env,message(51004,"/findmusic Hello",1));
  assert.equal(calls.filter(c=>c.method==="sendAudio").length,0);
  const sent=calls.filter(c=>c.method==="sendMessage");
  assert.ok(sent.length);
  assert.match(sent.at(-1).data.text,/پیدا نشد/);
  assert.equal(JSON.stringify(sent).includes("https://"),false);
});
