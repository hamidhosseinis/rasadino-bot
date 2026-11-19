import {searchITunes, searchAudius, officialLink} from "./providers.mjs";

const VALID_LANGUAGES = new Set(["fa","us"]);
const CACHE_TTL = 7200;
const SHORT_CACHE_TTL = 300;
const COOLDOWN_MS = 8000;

// Only query text (never a Telegram user ID) participates in the shared cache key.
export function validateMusicQuery(language, input) {
  if (!VALID_LANGUAGES.has(language) || typeof input !== "string") return null;
  const query = input.normalize("NFKC").replace(/[\u0000-\u001f\u007f-\u009f]/g," ").replace(/\s+/g," ").trim();
  if (query.length < 2 || query.length > 70 || !/[\p{L}\p{N}]/u.test(query)) return null;
  return query;
}

const canonical = value => String(value || "")
  .normalize("NFKC").toLocaleLowerCase("en")
  .replace(/[يى]/g,"ی").replace(/ك/g,"ک")
  .replace(/[\u064b-\u065f]/g,"")
  .replace(/[^\p{L}\p{N}]+/gu," ").trim();

function deduplicate(arr, limit=5) {
  const seen = new Set();
  const results = [];
  for (const t of arr) {
    const key=canonical(t.title)+"|"+canonical(t.artist);
    if (!key || key==="|" || seen.has(key)) continue;
    if (!officialLink(t.play_url,t.source==="iTunes"?"itunes":"audius")) continue;
    seen.add(key);
    results.push(t);
    if(results.length>=limit) break;
  }
  return results;
}

async function cacheKey(language, query) {
  const bytes = new TextEncoder().encode(language + "\n" + canonical(query));
  const digest = await crypto.subtle.digest("SHA-256",bytes);
  const hex = [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");
  return "music:search:v1:"+language+":"+hex;
}

export async function checkMusicSearchRate(env, chatId, now=Date.now()) {
  // Best-effort user throttle only: KV is eventually consistent, not an atomic rate limiter.
  if (!/^\d{1,20}$/.test(String(chatId))) return false;
  const key="music:search:cooldown:"+chatId;
  const previous=Number(await env.STATE.get(key));
  if (Number.isFinite(previous) && previous > 0 && now-previous < COOLDOWN_MS) return false;
  await env.STATE.put(key,String(now),{expirationTtl:60});
  return true;
}

export async function searchMusic(env,{language,query,fetcher=globalThis.fetch,now=Date.now()}={}) {
  const cleaned=validateMusicQuery(language,query);
  if (!cleaned) return {status:"invalid",tracks:[],fromCache:false,failedProviders:[]};
  const key=await cacheKey(language,cleaned);
  let cached=null;
  try {
    const text=await env.STATE.get(key);
    if (text) cached=JSON.parse(text);
  } catch { /* Cache outages must not disable read-only provider search. */ }
  if (cached?.status && Array.isArray(cached.tracks)
      && Number.isFinite(cached.checkedAt)
      && cached.checkedAt <= now
      && now-cached.checkedAt <= CACHE_TTL*1000) {
    return {...cached,fromCache:true};
  }

  const responses=await Promise.allSettled([
    searchITunes(cleaned,{fetcher}),
    searchAudius(cleaned,{fetcher})
  ]);
  const failedProviders=[];
  const combined=[];
  for(let i=0;i<responses.length;i++) {
    if (responses[i].status==="fulfilled") combined.push(...responses[i].value);
    else failedProviders.push(i===0?"iTunes":"Audius");
  }
  if(failedProviders.length===2) {
    return {status:"unavailable",tracks:[],failedProviders,fromCache:false,checkedAt:now};
  }
  const tracks=deduplicate(combined);
  const response = {
    status:tracks.length?"ok":"empty",
    tracks,
    failedProviders,
    fromCache:false,
    checkedAt:now
  };
  const ttl=failedProviders.length || !tracks.length ? SHORT_CACHE_TTL : CACHE_TTL;
  try {
    await env.STATE.put(key,JSON.stringify(response),{expirationTtl:ttl});
  } catch { /* A KV quota failure must not hide a successful search response. */ }
  return response;
}

const PERSIAN_NUMBERS=["۱","۲","۳","۴","۵"];
function cleanForMessage(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g," ").trim().slice(0,120);
}

export function renderMusicSearch(result,language) {
  const lang=language==="fa"?"فارسی":"انگلیسی (آمریکا)";
  const footer=[
    [{text:"🔎 جست‌وجوی دیگر",callback_data:"music:search:"+language}],
    [{text:"🎧 رصد موزیک",callback_data:"music:home"},
      {text:"🏠 منوی اصلی",callback_data:"main:menu"}],
    [{text:"❌ بستن",callback_data:"menu:close"}]
  ];
  if(result.status==="invalid")return {
    text:"⚠️ دستور نامعتبر؛ ۲ تا ۷۰ نویسه بنویس.\nمثال: /findmusic fa گوگوش | /findmusic us Coldplay",
    keyboard:{inline_keyboard:footer}
  };
  if(result.status==="unavailable")return {
    text:"⚠️ سرویس‌های جست‌وجوی موسیقی در دسترس نیستند؛ دوباره امتحان کن.",
    keyboard:{inline_keyboard:footer}
  };
  if(result.status==="empty")return {
    text:"🔎 نتیجه‌ای با لینک رسمی پیدا نشد؛ عبارت دیگری جست‌وجو کن.",
    keyboard:{inline_keyboard:footer}
  };
  const lines=["🔎 موسیقی | "+lang,"ℹ️ نتیجه جست‌وجوست، نه رتبه‌بندی یا تأیید ملیت."];
  for(let i=0;i<result.tracks.length;i++){
    const track=result.tracks[i];
    lines.push(PERSIAN_NUMBERS[i]+". 🎵 "+cleanForMessage(track.title)+" — "+
      cleanForMessage(track.artist)+(track.album?" | "+cleanForMessage(track.album):"")+
      (track.year?" | "+track.year:"")+
      (track.genre?" | "+cleanForMessage(track.genre):"")+" | "+track.source);
  }
  if(result.failedProviders?.length)lines.push("⚠️ برخی منابع پاسخ ندادند؛ فهرست ناقص است.");
  if(result.fromCache)lines.push("🕒 داده ذخیره‌شده");
  const links=result.tracks.map((track,i)=>[{
    text:"▶️ "+PERSIAN_NUMBERS[i]+" | "+track.source,
    url:track.play_url
  }]);
  return {text:lines.join("\n").slice(0,3900),keyboard:{inline_keyboard:[...links,...footer]}};
}
