import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.mjs";
import {recommendMusic,renderRecommendations,validRecommendationSelection} from "../src/music/recommendations.mjs";
import {getAudiusChart} from "../src/music/providers.mjs";

function itunes(id,title,artist,date="2026-10-05",genre="Pop"){
  return {kind:"song",wrapperType:"track",trackId:id,trackName:title,artistName:artist,
    collectionName:"Album",primaryGenreName:genre,releaseDate:date,
    trackViewUrl:"https://music.apple.com/us/album/sample/"+id+"?i="+id};
}
function audius(id,title,artist,genre="Pop",date="2026-09-01"){
  return {id,title,user:{name:artist},genre,release_date:date,play_count:1200,
    permalink:"/"+artist.toLowerCase().replaceAll(" ","-")+"/"+id};
}
function mockNetwork({apple=[itunes(12,"Sunshine","Singer")],music=[audius("aa12","Wave","Producer")],
  chart=[audius("ab13","Top Tune","Composer")],underground=[audius("an20","Indie Track","Creator")],
  failApple=false,failAudius=false}={}){
  const calls=[];
  const fetcher=async (raw)=>{
    const url=new URL(String(raw));calls.push(url);
    if(url.hostname==="itunes.apple.com"){
      if(failApple)return {ok:false,status:429,headers:{get:()=>null}};
      return {ok:true,status:200,headers:{get:()=>null},json:async()=>({results:apple})};
    }
    if(url.hostname==="api.audius.co"){
      if(failAudius)return {ok:false,status:503,headers:{get:()=>null}};
      const data=url.pathname.includes("underground")?underground:
        url.pathname.includes("trending")?chart:music;
      return {ok:true,status:200,headers:{get:()=>null},json:async()=>({data})};
    }
    throw Error("Unexpected host");
  };
  return {fetcher,calls};
}
function fakeKV(){
  const map=new Map(),writes=[];
  return {map,writes,async get(k){return map.get(k)??null},
    async put(k,v,o={}){writes.push({key:k,opts:o});map.set(k,v)},
    async delete(k){map.delete(k)},
    async list(){return {keys:[],list_complete:true}}};
}
const params=(language="us",genre="pop",mode="smart",count=5)=>({language,genre,mode,count});
const now=Date.parse("2026-11-18T12:00:00Z");

test("genre and callback selections are strictly whitelisted",()=>{
  assert.equal(validRecommendationSelection(params()),true);
  assert.equal(validRecommendationSelection(params("fa","nostalgia","new",10)),true);
  for(const bad of [params("zz"),params("us","traditional"),params("us","pop","unknown"),
    params("us","pop","new",2),params("us","pop","new",NaN),
    params("__proto__"),params("fa","__proto__")])
    assert.equal(validRecommendationSelection(bad),false);
});

test("unsupported daily mode never fabricates a chart or performs an upstream request",async()=>{
  const kv=fakeKV(),mock=mockNetwork();
  const r=await recommendMusic({STATE:kv},{...params("us","all","today",10),
    fetcher:mock.fetcher,now});
  assert.equal(r.status,"unsupported");
  assert.equal(mock.calls.length,0);
  assert.match(renderRecommendations(r).text,/جدول روزانه معتبر/);
  assert.equal(kv.map.size,0);
});
test("Persian weekly, all-time and underground rankings are withheld without verified source",async()=>{
  const kv=fakeKV(),mock=mockNetwork();
  for(const mode of ["week","classic","hidden"]){
    const r=await recommendMusic({STATE:kv},{...params("fa","pop",mode,10),fetcher:mock.fetcher,now});
    assert.equal(r.status,"unsupported");
    assert.deepEqual(r.tracks,[]);
  }
  assert.equal(mock.calls.length,0);
});

test("verified Audius weekly and all-time windows use source ranks, not invented positions",async()=>{
  const kv=fakeKV(),mock=mockNetwork({chart:[
    audius("one12","First Track","Artist One"),
    audius("two34","Second Track","Artist Two")
  ]});
  const week=await recommendMusic({STATE:kv},{...params("us","pop","week",5),fetcher:mock.fetcher,now});
  assert.equal(week.status,"ok");
  assert.equal(week.tracks[0].chart_rank,1);
  assert.equal(week.tracks[1].chart_rank,2);
  assert.ok(mock.calls.some(c=>c.pathname.endsWith("/tracks/trending")&&c.searchParams.get("time")==="week"&&c.searchParams.get("genre")==="Pop"));
  const rendered=renderRecommendations(week);
  assert.match(rendered.text,/جدول هفتگی Audius/);
  assert.match(rendered.text,/جهانی/);
  assert.ok(rendered.keyboard.inline_keyboard.some(row=>row.some(b=>b.url==="https://audius.co/artist-one/one12")));
  const classic=await recommendMusic({STATE:kv},{...params("us","all","classic",3),fetcher:mock.fetcher,now});
  assert.equal(classic.status,"ok");
  assert.ok(mock.calls.some(c=>c.searchParams.get("time")==="allTime"));
  assert.match(renderRecommendations(classic).text,/جدول تمام‌دوران Audius/);
});
test("underground uses documented Audius endpoint and cannot claim global all-time",async()=>{
  const mock=mockNetwork();
  const r=await recommendMusic({STATE:fakeKV()},{...params("us","all","hidden",1),fetcher:mock.fetcher,now});
  assert.equal(r.status,"ok");
  assert.ok(mock.calls.some(c=>c.pathname.endsWith("/tracks/trending/underground")));
  assert.match(renderRecommendations(r).text,/Underground/);
  await assert.rejects(getAudiusChart({underground:true,time:"allTime",fetcher:mock.fetcher}));
});

test("new releases require dated evidence no older than 18 months and are newest first",async()=>{
  const mock=mockNetwork({apple:[
    itunes(1,"Old Song","One","2011-01-01"),
    itunes(2,"Fresh","Two","2026-10-25"),
    itunes(3,"Newer","Three","2026-11-10"),
    itunes(4,"No Date","Four","")
  ],music:[audius("r213","Recent Audius","Five","Pop","2026-10-18")]});
  const r=await recommendMusic({STATE:fakeKV()},{...params("us","pop","new",10),fetcher:mock.fetcher,now});
  assert.equal(r.status,"ok");
  assert.deepEqual(r.tracks.map(t=>t.title),["Newer","Fresh","Recent Audius"]);
  assert.equal(r.tracks.every(t=>t.release_date!==null),true);
  assert.match(renderRecommendations(r).text,/۱۸ ماه گذشته/);
});

test("smart mode uses genre/recency, avoids duplicate artists and explicitly disclaims personalization",async()=>{
  const mock=mockNetwork({apple:[
    itunes(1,"Vintage","One","1980-01-01","Rock"),
    itunes(2,"Modern","One","2026-10-10","Pop"),
    itunes(3,"Today","Two","2026-11-05","Pop")
  ],music:[audius("a44","Modern","One"),audius("a55","Electro","Three","Electronic")]});
  const r=await recommendMusic({STATE:fakeKV()},{...params("us","pop","smart",3),fetcher:mock.fetcher,now});
  assert.equal(r.status,"ok");
  assert.equal(r.tracks.length,3);
  assert.equal(new Set(r.tracks.map(t=>t.artist)).size,3);
  const rendered=renderRecommendations(r);
  assert.match(rendered.text,/هنوز سلیقه شخصی تو آموخته نشده/);
  assert.ok(rendered.keyboard.inline_keyboard.flat().every(x=>!x.url||new URL(x.url).protocol==="https:"));
});

test("shared KV cache stores 10 max and permits expanding a 1-song request without refetch",async()=>{
  const kv=fakeKV(),mock=mockNetwork({apple:[
    itunes(1,"A","Artist A"),itunes(2,"B","Artist B"),itunes(3,"C","Artist C")
  ],music:[]});
  const first=await recommendMusic({STATE:kv},{...params("us","pop","smart",1),fetcher:mock.fetcher,now});
  const second=await recommendMusic({STATE:kv},{...params("us","pop","smart",3),fetcher:mock.fetcher,now:now+1000});
  assert.equal(first.tracks.length,1);
  assert.equal(second.tracks.length,3);
  assert.equal(second.fromCache,true);
  assert.equal(mock.calls.length,2);
  assert.ok(kv.map.has("music:recommend:v1:us:pop:smart"));
  assert.equal(kv.writes[0].opts.expirationTtl,3600);
});

test("two provider errors mean unavailable; partial failure is transparently labeled",async()=>{
  const allBad=mockNetwork({failApple:true,failAudius:true});
  const fail=await recommendMusic({STATE:fakeKV()},{...params(),fetcher:allBad.fetcher,now});
  assert.equal(fail.status,"unavailable");
  assert.deepEqual(fail.tracks,[]);
  const partial=mockNetwork({failAudius:true});
  const r=await recommendMusic({STATE:fakeKV()},{...params(),fetcher:partial.fetcher,now});
  assert.equal(r.status,"ok");
  assert.deepEqual(r.failedProviders,["Audius"]);
  assert.match(renderRecommendations(r).text,/اطلاعات به دلیل خطای برخی منابع/);
});

test("full interactive Worker menu returns ranked source results without extra Telegram messages",async t=>{
  const KV=fakeKV(),env={STATE:KV,BOT_TOKEN:"FAKE_STAGE6_BOT",WEBHOOK_SECRET:"FAKE_STAGE6_SECRET"};
  const old=globalThis.fetch,telegramCalls=[];
  globalThis.fetch=async(url,opts={})=>{
    const u=new URL(String(url));
    if(u.hostname==="api.telegram.org"){
      telegramCalls.push({method:u.pathname.split("/").at(-1),data:JSON.parse(opts.body)});
      return {ok:true,status:200,json:async()=>({ok:true,result:true})};
    }
    if(u.hostname==="api.audius.co"){
      return {ok:true,status:200,headers:{get:()=>null},json:async()=>({data:[
        audius("r123","Weekly Song","Weekly Singer")
      ]})};
    }
    throw Error("Unexpected host "+u.hostname);
  };
  t.after(()=>{globalThis.fetch=old});
  const update={update_id:45001,callback_query:{id:"recommend-stage6",
    data:"music:preview:us:pop:week:5",from:{id:99101},
    message:{message_id:51,chat:{id:99101,type:"private"}}}};
  const res=await worker.fetch(new Request("https://stage6.invalid/telegram",{
    method:"POST",headers:{"Content-Type":"application/json",
      "X-Telegram-Bot-Api-Secret-Token":env.WEBHOOK_SECRET},
    body:JSON.stringify(update)
  }),env);
  assert.equal(res.status,200);
  const edited=telegramCalls.filter(x=>x.method==="editMessageText");
  assert.equal(edited.length,1);
  assert.match(edited[0].data.text,/Weekly Song/);
  assert.equal(telegramCalls.filter(x=>x.method==="sendAudio").length,0);
  assert.equal(JSON.parse(await KV.get("user:99101")).notifications_enabled,false);
  assert.ok(KV.map.has("music:recommend:v1:us:pop:week"));
});
