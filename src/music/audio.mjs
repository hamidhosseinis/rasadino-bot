// Rasadino file-only music. Copyright-safe proof-of-concept: only CC0-licensed MP3
// from Wikimedia Commons may be transmitted. Never expose provider links to users.
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const MAX_QUERY = 80;
const NORMALIZE = text => String(text ?? "").normalize("NFKC").toLowerCase()
  .replace(/[يى]/g,"ی").replace(/ك/g,"ک")
  .replace(/[\u064b-\u065f\u0670\u200c\u200d]/g," ")
  .replace(/[^\p{L}\p{N}]+/gu," ").replace(/\s+/g," ").trim();

export function validAudioQuery(text) {
  const query = String(text ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g," ").trim().replace(/\s+/g," ");
  return query.length >= 2 && query.length <= MAX_QUERY && NORMALIZE(query).length >= 2 ? query : null;
}
function editDistance(a,b) {
  if (!a || !b) return Math.max(a.length,b.length);
  if (a.length > 100 || b.length > 100) return 100;
  let row = Array.from({length:b.length+1},(_,i)=>i);
  for (let i=1;i<=a.length;i++) {
    const next=[i];
    for (let j=1;j<=b.length;j++)
      next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+(a[i-1]===b[j-1]?0:1));
    row=next;
  }
  return row[b.length];
}
function score(query, title) {
  const q=NORMALIZE(query),t=NORMALIZE(title);
  if (!q || !t) return 0;
  if (q===t) return 1;
  if (t.includes(q)) return 0.90;
  const qa=q.split(" "),ta=t.split(" ");
  const covered=qa.map(word=>{
    let best=0;
    for(const candidate of ta) {
      if(word===candidate){best=1;break;}
      if(word.length>=4 && candidate.length>=4) {
        const dist=editDistance(word,candidate);
        if(dist<=2) best=Math.max(best,1-dist/Math.max(word.length,candidate.length));
      }
    }
    return best;
  }).reduce((a,b)=>a+b,0)/qa.length;
  const brevity=Math.min(1,(qa.length+2)/(ta.length+1));
  return covered*(0.73+0.27*brevity);
}
function isCC0(ext) {
  const short=String(ext?.LicenseShortName?.value??"").toLowerCase().trim();
  const url=String(ext?.LicenseUrl?.value??"");
  return /^cc0(?:\s*1\.0)?$/i.test(short)
    && /^https?:\/\/creativecommons\.org\/publicdomain\/zero\/1\.0\/?$/i.test(url);
}
function safeCommonsAudio(raw) {
  if (typeof raw !== "string" || raw.length>2000) return null;
  try {
    const u=new URL(raw);
    return u.protocol==="https:" && u.hostname==="upload.wikimedia.org"
      && !u.username && !u.password && /\.mp3$/i.test(decodeURIComponent(u.pathname))
      ? u.href:null;
  }catch{return null;}
}
export function normalizeCommonsFile(page) {
  if (!page || typeof page.title!=="string" || !/^File:/i.test(page.title)) return null;
  const info=page.imageinfo?.[0];
  if (!info || !isCC0(info.extmetadata) || !Number.isFinite(info.size)
      || info.size < 100_000 || info.size > MAX_AUDIO_BYTES
      || !/^audio\/(?:mpeg|mp3)$/i.test(String(info.mime??""))) return null;
  if(!/\.mp3$/i.test(page.title))return null;
  const url=safeCommonsAudio(info.url);
  if (!url)return null;
  const title=page.title.slice(5).replace(/\.mp3$/i,"").replace(/[_]+/g," ").trim();
  if (!title || title.length>160)return null;
  return {title,url,license:"CC0",bytes:info.size};
}
async function commonsSearch(query,fetcher) {
  const u=new URL(COMMONS_API);
  for(const [key,value] of Object.entries({
    action:"query",generator:"search",gsrsearch:query,gsrnamespace:"6",
    gsrlimit:"25",prop:"imageinfo",iiprop:"url|size|mime|extmetadata",
    format:"json",formatversion:"2"
  }))u.searchParams.set(key,value);
  const response=await fetcher(u.href,{
    headers:{"Accept":"application/json","User-Agent":"RasadinoBot/1.0 (music: CC0 only)"},
    signal:AbortSignal.timeout(8500)
  });
  if(!response.ok)throw new Error("Commons unavailable");
  const length=Number(response.headers?.get?.("content-length"));
  if(Number.isFinite(length)&&length>2_000_000)throw new Error("Commons response too large");
  const json=await response.json();
  if(json?.error)throw new Error("Commons API error");
  return (Array.isArray(json?.query?.pages)?json.query.pages:[])
    .map(normalizeCommonsFile).filter(Boolean);
}
export async function findAudioFiles(query,{fetcher=globalThis.fetch}={}) {
  const clean=validAudioQuery(query);
  if(!clean)return {status:"invalid",files:[]};
  let files=[],ok=false;
  try {
    files=await commonsSearch(clean,fetcher);
    ok=true;
    // Fallback to a distinctive word for user typos / missing artist titles.
    if(!files.length) {
      const terms=NORMALIZE(clean).split(" ").filter(s=>s.length>=4);
      const term=terms.sort((a,b)=>b.length-a.length)[0];
      if(term && term!==NORMALIZE(clean))
        files=await commonsSearch(term,fetcher);
    }
  }catch {
    if(!ok)return {status:"unavailable",files:[]};
  }
  const seen=new Set();
  const ranked=files.map(file=>({...file,score:score(clean,file.title)}))
    .filter(file=>file.score>=0.54 && !seen.has(file.url) && seen.add(file.url))
    .sort((a,b)=>b.score-a.score).slice(0,3);
  return {status:ranked.length?"ok":"empty",files:ranked};
}

export const audioHomeView = () => ({
  text:"🎧 نام آهنگ یا خواننده رو بفرست.\nفقط فایل‌های MP3 دارای مجوز بازنشر ارسال می‌شن؛ بدون لینک.",
  keyboard:{inline_keyboard:[
    [{text:"🔎 جستجوی آهنگ",callback_data:"music:home"}],
    [{text:"🏠 منوی اصلی",callback_data:"main:menu"},{text:"❌ بستن",callback_data:"menu:close"}]
  ]}
});
export const audioRetryView = (message) => ({
  text:message,
  keyboard:{inline_keyboard:[
    [{text:"🔎 جستجوی دوباره",callback_data:"music:home"}],
    [{text:"🏠 منوی اصلی",callback_data:"main:menu"}]
  ]}
});
export function audioChoicesView(files) {
  return {
    text:"🎧 چند آهنگ مشابه پیدا شد؛ کدوم رو می‌خوای؟",
    keyboard:{inline_keyboard:[
      ...files.slice(0,3).map((f,i)=>[{text:(i+1)+". "+f.title.slice(0,54),callback_data:"music:pick:"+i}]),
      [{text:"🔎 جستجوی دوباره",callback_data:"music:home"}],
      [{text:"🏠 منوی اصلی",callback_data:"main:menu"}]
    ]}
  };
}
// Auto-send only if title has a strong, unambiguous match; otherwise ask.
export const confidentAudioMatch = files =>
  files.length===1 && files[0].score>=0.86 ||
  files.length>1 && files[0].score>=0.96 && files[0].score-files[1].score>=0.22;
