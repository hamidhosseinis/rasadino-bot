// Stage 6: source-backed, non-personalized discovery. Never invent charts or user tastes.
import {GENRES, TYPES, COUNTS} from "./menus.mjs";
import {searchITunes, searchAudius, getAudiusChart, officialLink} from "./providers.mjs";

const US_GENRE = Object.freeze({
  pop:"Pop",rock:"Rock",hiphop:"Hip-Hop/Rap",rnb:"R&B/Soul",
  country:"Country",electronic:"Electronic",jazz:"Jazz",all:null
});
const QUERY_WORDS=Object.freeze({
  fa:Object.freeze({pop:"Persian pop",rock:"Persian rock",rap:"Persian rap",
    traditional:"Persian traditional",fusion:"Persian fusion",
    electronic:"Persian electronic",nostalgia:"Googoosh",all:"Persian music"}),
  us:Object.freeze({pop:"pop",rock:"rock",hiphop:"hip hop",rnb:"R&B",
    country:"country",electronic:"electronic",jazz:"jazz",all:"music"})
});
const CACHE_SECONDS=3600;
const CACHE_SHORT=240;
const labels=Object.freeze({today:"ترندهای امروز",week:"محبوب‌ترین‌های هفته",
  classic:"برترین‌های تمام دوران",new:"جدیدترین آهنگ‌ها",
  hidden:"آثار کمترشناخته‌شده",smart:"انتخاب خودکار"});
const indexLabel=["۱","۲","۳","۴","۵","۶","۷","۸","۹","۱۰"];
const fold = value => String(value??"").normalize("NFKC").toLowerCase()
  .replace(/[يى]/g,"ی").replace(/ك/g,"ک")
  .replace(/[^\p{L}\p{N}]+/gu," ").trim();
const safe = value => String(value??"").replace(/[\u0000-\u001f\u007f-\u009f]/g," ").trim().slice(0,140);
const modeIs = mode => TYPES.some(([id])=>id===mode);
const validGenre = (language,genre) => Object.hasOwn(GENRES,language)
  && GENRES[language].some(([id])=>id===genre);

export function validRecommendationSelection({language,genre,mode,count}) {
  return validGenre(language,genre) && modeIs(mode)
    && COUNTS.includes(count);
}

function genreName(language,genre){
  return GENRES[language]?.find(([id])=>id===genre)?.[1]??"نامشخص";
}
function scoreTrack(track,genre,now) {
  let score=0;
  const g=fold(track.genre);
  const needle=fold(US_GENRE[genre]??"");
  if(genre==="all") score+=15;
  else if(needle && (g.includes(needle)||needle.includes(g)&&g))score+=40;
  if(track.release_date) {
    const date=Date.parse(track.release_date+"T00:00:00Z");
    const age=(now-date)/86400000;
    if(age>=0&&age<365)score+=30;
    else if(age>=365&&age<1095)score+=15;
  }
  if(track.source==="iTunes")score+=7;
  if(Number.isFinite(track.play_count))score+=Math.min(12,Math.log10(track.play_count+1)*3);
  return score;
}
function uniqueTracks(tracks,count,mode,genre,now) {
  const seen=new Set(),list=[];
  for(const track of tracks){
    const key=fold(track.artist)+"|"+fold(track.title);
    if(seen.has(key)||!safe(track.title)||!safe(track.artist))continue;
    if(!officialLink(track.play_url,track.source==="iTunes"?"itunes":"audius"))continue;
    seen.add(key);list.push(track);
  }
  if(mode==="new"){
    const windowStart=now-540*86400000;
    list.splice(0,list.length,...list.filter(t=>{
      const d=Date.parse((t.release_date??"")+"T00:00:00Z");
      return Number.isFinite(d)&&d>=windowStart&&d<=now;
    }));
    list.sort((a,b)=>String(b.release_date).localeCompare(String(a.release_date)));
  }else if(mode==="smart"){
    list.sort((a,b)=>scoreTrack(b,genre,now)-scoreTrack(a,genre,now));
  }
  const artists=new Set(),output=[];
  // Chart rankings must never be reordered; for source charts keep original order.
  const isChart=["week","classic","hidden"].includes(mode);
  for(const track of list){
    const artist=fold(track.artist);
    if(!isChart&&artists.has(artist))continue;
    artists.add(artist);output.push(track);
    if(output.length===count)break;
  }
  // If a catalog provides fewer unique artists, allow repeated artists (still dedup tracks).
  if(!isChart&&output.length<count){
    for(const track of list){
      if(output.some(x=>x.id===track.id))continue;
      output.push(track);
      if(output.length===count)break;
    }
  }
  return output;
}

export async function recommendMusic(env,{language,genre,mode,count,fetcher=globalThis.fetch,now=Date.now()}={}) {
  if(!validRecommendationSelection({language,genre,mode,count}))
    return {status:"invalid",tracks:[],language,genre,mode,count};
  // No genuine daily chart exists in supported free providers.
  if(mode==="today") return {status:"unsupported",reason:"daily_chart",tracks:[],language,genre,mode,count};
  // English/American region is a discovery preference, not verified citizenship.
  // Audius has no language field, so globally-ranked music must not masquerade as Persian.
  if(language==="fa"&&["week","classic","hidden"].includes(mode))
    return {status:"unsupported",reason:"no_fa_chart",tracks:[],language,genre,mode,count};

  const cacheKey="music:recommend:v1:"+language+":"+genre+":"+mode;
  try {
    const raw=await env.STATE.get(cacheKey);
    if(raw){
      const entry=JSON.parse(raw);
      if(entry?.schema===1&&Array.isArray(entry.tracks)&&entry.checkedAt<=now
        && now-entry.checkedAt<CACHE_SECONDS*1000&&entry.status!=="unavailable")
        return {...entry,tracks:entry.tracks.slice(0,count),count,fromCache:true};
    }
  }catch{ /* Cache not required for recommendations. */ }

  let candidates=[],sourceNote="",genreVerified=false,failures=[];
  if(["week","classic","hidden"].includes(mode)) {
    try{
      const underground=mode==="hidden";
      const time=mode==="classic"?"allTime":"week";
      candidates=await getAudiusChart({
        time,genre:underground?null:US_GENRE[genre]??null,
        limit:36,underground,fetcher
      });
      if(underground&&genre!=="all"){
        const wanted=fold(US_GENRE[genre]);
        candidates=candidates.filter(t=>fold(t.genre).includes(wanted));
      }
      sourceNote=mode==="week"?"جدول هفتگی Audius (جهانی)":
        mode==="classic"?"جدول تمام‌دوران Audius (جهانی)":
        "جدول مستقل/Underground در Audius (جهانی؛ نه رتبه‌بندی عمومی)";
      genreVerified=genre==="all"||candidates.every(t=>Boolean(t.genre));
    }catch{failures.push("Audius")}
  }else{
    const query=QUERY_WORDS[language][genre];
    const responses=await Promise.allSettled([
      searchITunes(query,{fetcher}),
      searchAudius(query,{fetcher})
    ]);
    for(let i=0;i<responses.length;i++){
      if(responses[i].status==="fulfilled")candidates.push(...responses[i].value);
      else failures.push(i===0?"iTunes":"Audius");
    }
    sourceNote="جست‌وجوی کاتالوگ iTunes آمریکا و Audius؛ گزینش الگوریتمی رصدینو";
  }
  if(failures.length===(["week","classic","hidden"].includes(mode)?1:2))
    return {status:"unavailable",tracks:[],language,genre,mode,count,failedProviders:failures};
  const tracks=uniqueTracks(candidates,count,mode,genre,now);
  const result={schema:1,status:tracks.length?"ok":"empty",tracks,
    language,genre,mode,count,sourceNote,genreVerified,failedProviders:failures,
    fromCache:false,checkedAt:now};
  const ttl=tracks.length&&failures.length===0?CACHE_SECONDS:CACHE_SHORT;
  // Cache up to 10 tracks rather than just the user requested 1/3/5, to avoid truncation.
  const cachedTracks=uniqueTracks(candidates,10,mode,genre,now);
  try{await env.STATE.put(cacheKey,JSON.stringify({...result,count:10,tracks:cachedTracks}),{expirationTtl:ttl})}
  catch{ /* KV quota must not make an already obtained result vanish. */ }
  return result;
}

export function renderRecommendations(result){
  const language=result.language==="fa"?"فارسی":"انگلیسی (آمریکا)";
  const genre=validGenre(result.language,result.genre)?genreName(result.language,result.genre):"نامشخص";
  const mode=labels[result.mode]??"پیشنهاد";
  const footer=[
    [{text:"🔁 انتخاب دوباره",callback_data:"music:type:"+result.language+":"+result.genre+":"+result.mode}],
    [{text:"🎧 رصد موزیک",callback_data:"music:home"},
      {text:"🏠 منوی اصلی",callback_data:"main:menu"}],
    [{text:"❌ بستن",callback_data:"menu:close"}]
  ];
  if(result.status==="unsupported")return {
    text:result.reason==="daily_chart"
      ?"⚠️ جدول روزانه معتبر برای ترند امروز در دسترس نیست.\n🆕 «جدیدترین» یا 🤖 «انتخاب خودکار» را بزن."
      :"⚠️ جدول معتبر مخصوص رتبه‌بندی فارسی موجود نیست.\n🆕 «جدیدترین» یا 🤖 «انتخاب خودکار» را بزن.",
    keyboard:{inline_keyboard:footer}
  };
  if(result.status==="unavailable")return {
    text:"⚠️ منابع موسیقی موقتاً در دسترس نیستند؛ دوباره امتحان کن.",
    keyboard:{inline_keyboard:footer}
  };
  if(result.status!=="ok"||!result.tracks?.length)return {
    text:"🔎 آهنگ قابل‌تأییدی پیدا نشد؛ ژانر یا نوع را تغییر بده.",
    keyboard:{inline_keyboard:footer}
  };
  const notes=["🎧 "+language+" | "+genre+" | "+mode,
    "📚 "+result.sourceNote];
  if(result.mode==="new")notes.push("🆕 انتشار: ۱۸ ماه گذشته، از جدیدترین");
  if(result.mode==="smart")notes.push("🤖 انتخاب بر اساس تازگی/ژانر/تنوع؛ هنوز سلیقه شخصی تو آموخته نشده است.");
  notes.push("ℹ️ ژانر، زبان و ملیت همه آثار مستقلاً تأیید نشده‌اند.");
  if(result.failedProviders?.length)notes.push("⚠️ اطلاعات به دلیل خطای برخی منابع ناقص است.");
  if(result.fromCache)notes.push("🕒 داده ذخیره‌شده");
  result.tracks.forEach((track,i)=>{
    const date=track.release_date||track.year||null;
    const rank=track.chart_rank&&["week","classic"].includes(result.mode)?" | رتبه "+track.chart_rank:"";
    notes.push(indexLabel[i]+". 🎵 "+safe(track.title)+" — "+safe(track.artist)+
      (date?" | "+date:"")+(track.genre?" | "+safe(track.genre):"")+
      rank+" | "+track.source);
  });
  const links=result.tracks.map((track,i)=>[{text:"▶️ "+indexLabel[i]+" | "+track.source,url:track.play_url}]);
  return {text:notes.join("\n").slice(0,3900),keyboard:{inline_keyboard:[...links,...footer]}};
}
