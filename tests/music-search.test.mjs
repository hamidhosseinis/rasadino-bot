import test from "node:test";
import assert from "node:assert/strict";
import {normalizeITunes, normalizeAudius, officialLink,searchITunes,searchAudius} from "../src/music/providers.mjs";
import {validateMusicQuery, searchMusic, checkMusicSearchRate, renderMusicSearch} from "../src/music/search.mjs";
import {musicMenuView} from "../src/music/menus.mjs";
import worker from "../src/worker.mjs";

const itunesTrack = (id=123, title="Hello", artist="Adele")=>({
  kind:"song",wrapperType:"track",trackId:id,trackName:title,artistName:artist,
  collectionName:"25",releaseDate:"2015-10-23T07:00:00Z",primaryGenreName:"Pop",
  trackViewUrl:"https://music.apple.com/us/album/hello/123?i="+id,
  previewUrl:"https://audio-ssl.itunes.apple.com/preview.m4a"
});
const audiusTrack=(id="a1",title="Hello",artist="Adele")=>({
  id,title,user:{name:artist},genre:"Pop",releaseDate:"2016-10-20",
  permalink:"https://audius.co/adele/hello-"+id,
  trackCid:"sensitive-audio-reference"
});

function response(data,{status=200}={}) {
  return {ok:status>=200&&status<300,status,headers:{get:()=>null},json:async()=>data};
}
function providerStub({itunes=[itunesTrack()],audius=[audiusTrack()],
  itunesStatus=200,audiusStatus=200}={}) {
  const calls=[];
  return {calls,fetcher:async url=>{
    const u=new URL(String(url));
    calls.push(u);
    if(u.hostname==="itunes.apple.com")return response({resultCount:itunes.length,results:itunes},{status:itunesStatus});
    if(u.hostname==="api.audius.co")return response({data:audius},{status:audiusStatus});
    throw new Error("Unexpected external request");
  }};
}
function fakeState() {
  const data=new Map(),operations=[];
  return {
    data,operations,
    async get(key){operations.push({action:"get",key});return data.get(key)??null;},
    async put(key,value,opts={}){operations.push({action:"put",key,opts});data.set(key,value);},
    async delete(key){operations.push({action:"delete",key});data.delete(key);},
    async list(){return {keys:[],list_complete:true};}
  };
}

test("search validation rejects missing, oversized, punctuation-only and unknown-language queries",()=>{
  assert.equal(validateMusicQuery("fr","Hello"),null);
  assert.equal(validateMusicQuery("fa"," "),null);
  assert.equal(validateMusicQuery("us","!?!"),null);
  assert.equal(validateMusicQuery("us","a".repeat(71)),null);
  assert.equal(validateMusicQuery("fa","  گوگوش   بهار "), "گوگوش بهار");
  assert.equal(validateMusicQuery("us","  Taylor  Swift  "), "Taylor Swift");
});

test("metadata adapters accept official URLs only and never propagate previews or CIDs",()=>{
  assert.equal(officialLink("http://music.apple.com/album/1","itunes"),null);
  assert.equal(officialLink("https://music.apple.com.evil.tld/album/1","itunes"),null);
  assert.equal(officialLink("https://evil.tld/audius.co/song","audius"),null);
  assert.equal(normalizeITunes({...itunesTrack(),trackViewUrl:"https://example.com/evil"}),null);
  assert.equal(normalizeITunes({...itunesTrack(),kind:"podcast"}),null);
  assert.equal(normalizeAudius({...audiusTrack(),permalink:"http://audius.co/artist/song"}),null);
  const apple=normalizeITunes(itunesTrack());
  assert.equal(apple.year,2015);
  assert.equal(apple.album,"25");
  assert.equal("previewUrl" in apple,false);
  assert.equal("artworkUrl100" in apple,false);
  const aud=normalizeAudius(audiusTrack());
  assert.equal(aud.year,2016);
  assert.equal(aud.source,"Audius");
  assert.equal("trackCid" in aud,false);
  const relative=normalizeAudius({...audiusTrack(),permalink:"/adele/hello-a1"});
  assert.equal(relative.play_url,"https://audius.co/adele/hello-a1");
  assert.equal(officialLink("//evil.example/trap","audius"),null);
  assert.equal(officialLink("/artist/song?redirect=https://evil.example","audius"),null);
  assert.equal(officialLink("/artist/song#fragment","audius"),null);
  assert.equal(officialLink("/artist\\\\evil","audius"),null);
  assert.equal(officialLink("/artist/song","itunes"),null);
});

test("provider requests contain only searched music metadata, fixed HTTPS host, no tokens",async()=>{
  const {calls,fetcher}=providerStub();
  const a=await searchITunes("Taylor Swift",{fetcher});
  const b=await searchAudius("Taylor Swift",{fetcher});
  assert.equal(a.length,1);
  assert.equal(b.length,1);
  assert.equal(calls.length,2);
  assert.equal(calls[0].hostname,"itunes.apple.com");
  assert.equal(calls[0].searchParams.get("term"),"Taylor Swift");
  assert.equal(calls[0].searchParams.get("entity"),"song");
  assert.equal(calls[0].searchParams.get("country"),"US");
  assert.equal(calls[1].hostname,"api.audius.co");
  assert.equal(calls[1].pathname,"/v1/tracks/search");
  assert.equal(calls[1].searchParams.get("query"),"Taylor Swift");
  assert.ok(calls.every(u=>u.protocol==="https:" && !u.searchParams.has("api_key")));
});

test("search combines sources and eliminates exact artist/title duplicates",async()=>{
  const state=fakeState(),mock=providerStub();
  const result=await searchMusic({STATE:state},{language:"us",query:"Hello Adele",fetcher:mock.fetcher,now:1700000000000});
  assert.equal(result.status,"ok");
  assert.equal(result.tracks.length,1);
  assert.equal(result.tracks[0].source,"iTunes");
  assert.equal(result.failedProviders.length,0);
  assert.equal(mock.calls.length,2);
});

test("cache avoids second pair of API calls and does not include raw query or user ID in key",async()=>{
  const state=fakeState(),mock=providerStub();
  const args={language:"fa",query:"Hello",fetcher:mock.fetcher,now:1700000000000};
  const first=await searchMusic({STATE:state},args);
  const second=await searchMusic({STATE:state},{...args,query:"HELLO",now:1700000001000});
  assert.equal(first.status,"ok");
  assert.equal(second.fromCache,true);
  assert.equal(mock.calls.length,2);
  assert.equal(state.data.size,1);
  for(const key of state.data.keys()){
    assert.match(key,/^music:search:v1:fa:[a-f0-9]{64}$/);
    assert.equal(key.includes("Hello"),false);
  }
  assert.equal(state.operations.find(x=>x.action==="put").opts.expirationTtl,7200);
});

test("one failing upstream provider gives honest partial results and short cache TTL",async()=>{
  const state=fakeState();
  const mock=providerStub({itunesStatus:503,audius:[audiusTrack("b2","Top Song","Local Artist")]});
  const r=await searchMusic({STATE:state},{language:"fa",query:"Top Song",fetcher:mock.fetcher});
  assert.equal(r.status,"ok");
  assert.deepEqual(r.failedProviders,["iTunes"]);
  assert.equal(r.tracks[0].source,"Audius");
  assert.equal(state.operations.find(x=>x.action==="put").opts.expirationTtl,300);
  const view=renderMusicSearch(r,"fa");
  assert.match(view.text,/برخی منابع پاسخ ندادند/);
  assert.equal(view.keyboard.inline_keyboard[0][0].url,r.tracks[0].play_url);
});

test("all failed sources never fabricate tracks or cache a failure",async()=>{
  const state=fakeState();
  const mock=providerStub({itunesStatus:429,audiusStatus:503});
  const r=await searchMusic({STATE:state},{language:"us",query:"Hello",fetcher:mock.fetcher});
  assert.equal(r.status,"unavailable");
  assert.deepEqual(r.tracks,[]);
  assert.equal(state.operations.filter(x=>x.action==="put").length,0);
  assert.match(renderMusicSearch(r,"us").text,/سرویس‌های جست‌وجوی موسیقی/);
});

test("successful empty provider responses are correctly labeled and short-lived",async()=>{
  const state=fakeState();
  const mock=providerStub({itunes:[],audius:[]});
  const r=await searchMusic({STATE:state},{language:"fa",query:"An obscure unreleased title",fetcher:mock.fetcher});
  assert.equal(r.status,"empty");
  assert.equal(r.tracks.length,0);
  assert.equal(state.operations.find(x=>x.action==="put").opts.expirationTtl,300);
  assert.match(renderMusicSearch(r,"fa").text,/نتیجه‌ای/);
});

test("user throttle is best-effort, per chat, has TTL and never alters price notifications",async()=>{
  const state=fakeState(),env={STATE:state};
  assert.equal(await checkMusicSearchRate(env,"1000",100000),true);
  assert.equal(await checkMusicSearchRate(env,"1000",100100),false);
  assert.equal(await checkMusicSearchRate(env,"1001",100100),true);
  assert.equal(await checkMusicSearchRate(env,"1000",108100),true);
  assert.equal(await checkMusicSearchRate(env,"not-id",200000),false);
  assert.equal(state.operations.filter(x=>x.action==="put").every(x=>x.opts.expirationTtl===60),true);
  assert.equal([...state.data.keys()].every(k=>k.startsWith("music:search:cooldown:")),true);
});

test("search screen is accessible from both languages with navigation to prior menu",()=>{
  for(const lang of ["fa","us"]){
    const screen=musicMenuView("music:lang:"+lang);
    assert.ok(screen.keyboard.inline_keyboard.flat().some(x=>x.callback_data==="music:search:"+lang));
    const search=musicMenuView("music:search:"+lang);
    assert.match(search.text,/findmusic/);
    assert.ok(search.keyboard.inline_keyboard.flat().some(x=>x.callback_data==="music:lang:"+lang));
  }
  assert.equal(musicMenuView("music:search:xx"),null);
});


test("real Worker handles legacy /findmusic with file-only result",async t=>{
  const state=fakeState(),env={STATE:state,BOT_TOKEN:"FAKE_MUSIC_TOKEN",WEBHOOK_SECRET:"FAKE_MUSIC_WEBHOOK"};
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,opts={})=>{
    const u=new URL(String(url));
    if(u.hostname==="api.telegram.org"){
      const method=u.pathname.split("/").at(-1);
      calls.push({method,payload:JSON.parse(opts.body)});
      return response({ok:true,result:{audio:{file_id:"FAKE_AUDIO"}}});
    }
    if(u.hostname==="commons.wikimedia.org")return response({query:{pages:[{
      title:"File:Hello.mp3",imageinfo:[{url:"https://upload.wikimedia.org/wikipedia/commons/1/11/Hello.mp3",
        size:800000,mime:"audio/mpeg",extmetadata:{
          LicenseShortName:{value:"CC0"},LicenseUrl:{value:"https://creativecommons.org/publicdomain/zero/1.0/"}
        }}]
    }]}});
    throw Error("Unexpected host "+u.hostname);
  };
  t.after(()=>{globalThis.fetch=original;});
  const update={update_id:83791,message:{chat:{id:4901,type:"private"},from:{id:4901},text:"/findmusic us Hello"}};
  const resp=await worker.fetch(new Request("https://example.invalid/telegram",{
    method:"POST",headers:{"Content-Type":"application/json","X-Telegram-Bot-Api-Secret-Token":env.WEBHOOK_SECRET},
    body:JSON.stringify(update)
  }),env);
  assert.equal(resp.status,200);
  assert.equal(calls.filter(x=>x.method==="sendAudio").length,1);
  assert.equal(calls.filter(x=>x.method==="sendMessage").length,0);
  assert.equal(JSON.parse(await state.get("user:4901")).notifications_enabled,false);
});


test("group request and invalid music name cannot trigger external provider calls",async t=>{
  const state=fakeState(),env={STATE:state,BOT_TOKEN:"FAKE_MUSIC_TOKEN",WEBHOOK_SECRET:"FAKE_MUSIC_WEBHOOK"};
  const old=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,opts)=>{
    const u=new URL(String(url));
    assert.equal(u.hostname,"api.telegram.org");
    calls.push(JSON.parse(opts.body));
    return response({ok:true,result:true});
  };
  t.after(()=>{globalThis.fetch=old;});
  const send=update=>worker.fetch(new Request("https://example.invalid/telegram",{
    method:"POST",headers:{"Content-Type":"application/json","X-Telegram-Bot-Api-Secret-Token":env.WEBHOOK_SECRET},
    body:JSON.stringify(update)
  }),env);
  assert.equal((await send({update_id:1001,message:{chat:{id:-10022,type:"supergroup"},text:"/findmusic Hello"}})).status,200);
  assert.equal(calls.length,0);
  assert.equal((await send({update_id:1002,message:{chat:{id:77202,type:"private"},from:{id:77202},text:"/findmusic !!"}})).status,200);
  assert.equal(calls.length,1);
  assert.match(calls[0].text,/۲ تا ۸۰/);
});


test("legacy search callback now accepts next plain text but never returns media links",async t=>{
  const STATE=fakeState(),env={STATE,BOT_TOKEN:"FAKE_MUSIC_TOKEN",WEBHOOK_SECRET:"FAKE_MUSIC_WEBHOOK"};
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,options={})=>{
    const u=new URL(String(url));
    if(u.hostname==="api.telegram.org"){
      calls.push({method:u.pathname.split("/").at(-1),payload:JSON.parse(options.body)});
      return response({ok:true,result:true});
    }
    if(u.hostname==="commons.wikimedia.org")return response({query:{pages:[]}});
    throw Error("Unexpected network request "+u.hostname);
  };
  t.after(()=>{globalThis.fetch=original});
  const deliver=update=>worker.fetch(new Request("https://example.invalid/telegram",{
    method:"POST",headers:{"Content-Type":"application/json","X-Telegram-Bot-Api-Secret-Token":env.WEBHOOK_SECRET},
    body:JSON.stringify(update)
  }),env);
  const cb={update_id:20100,callback_query:{id:"pending-20100",data:"music:search:fa",
    from:{id:55112},message:{message_id:55,chat:{id:55112,type:"private"}}}};
  assert.equal((await deliver(cb)).status,200);
  assert.equal(STATE.data.get("music:pending:55112"),"file");
  assert.equal(STATE.operations.find(x=>x.key==="music:pending:55112"&&x.action==="put").opts.expirationTtl,300);
  assert.equal((await deliver({update_id:20101,message:{chat:{id:55112,type:"private"},
    from:{id:55112},text:"Googoosh"}})).status,200);
  assert.equal(STATE.data.get("music:pending:55112"),"file");
  const sent=calls.filter(x=>x.method==="sendMessage");
  assert.equal(sent.length,1);
  assert.match(sent[0].payload.text,/پیدا نشد/);
  assert.equal(JSON.stringify(sent).includes("https://"),false);
  assert.equal(calls.filter(x=>x.method==="sendAudio").length,0);
});


test("main menu cancels free-text music requests",async t=>{
  const STATE=fakeState(),env={STATE,BOT_TOKEN:"FAKE_MUSIC_TOKEN",WEBHOOK_SECRET:"FAKE_MUSIC_WEBHOOK"};
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,opts)=>{
    assert.ok(String(url).startsWith("https://api.telegram.org/"));
    calls.push({url:String(url),payload:JSON.parse(opts.body)});
    return response({ok:true,result:true});
  };
  t.after(()=>{globalThis.fetch=original});
  const deliver=update=>worker.fetch(new Request("https://example.invalid/telegram",{
    method:"POST",headers:{"Content-Type":"application/json","X-Telegram-Bot-Api-Secret-Token":env.WEBHOOK_SECRET},
    body:JSON.stringify(update)
  }),env);
  const cb=(update_id,data)=>({update_id,callback_query:{id:"cb-"+update_id,data,
    from:{id:66101},message:{message_id:23,chat:{id:66101,type:"private"}}}});
  await deliver(cb(30200,"music:search:us"));
  assert.equal(STATE.data.get("music:pending:66101"),"file");
  await deliver(cb(30201,"main:menu"));
  assert.equal(STATE.data.has("music:pending:66101"),false);
  await deliver({update_id:30202,message:{chat:{id:66101,type:"private"},
    from:{id:66101},text:"Hello"}});
  assert.match(calls.at(-1).payload.text,/خوش آمدی/);
});

test("Audius relative permalink is resolved only to audius.co, never to another host",()=>{
  const relative=normalizeAudius({...audiusTrack("valid42"),permalink:"/artist-name/valid-track"});
  assert.ok(relative);
  assert.equal(relative.play_url,"https://audius.co/artist-name/valid-track");
  const absolute=normalizeAudius({...audiusTrack("valid43"),permalink:"https://audius.co/artist-name/valid-track"});
  assert.ok(absolute);
  for(const permalink of ["//evil.example/steal","///evil.example/steal",
    "/\\\\evil.example/steal","https://audius.co.evil.example/track",
    "https://evil.example/audius.co/song","javascript:alert(1)","/foo\u0000bar"]){
    assert.equal(normalizeAudius({...audiusTrack("bad44"),permalink}),null,permalink);
  }
});

test("realistic Audius search response with relative permalink now returns tracks",async()=>{
  const {fetcher}=providerStub({audius:[{
    ...audiusTrack("abc_42","Music For You","Artist Name"),
    permalink:"/artist-name/music-for-you"
  }]});
  const results=await searchAudius("Music For You",{fetcher});
  assert.equal(results.length,1);
  assert.equal(results[0].source,"Audius");
  assert.equal(results[0].play_url,"https://audius.co/artist-name/music-for-you");
});
