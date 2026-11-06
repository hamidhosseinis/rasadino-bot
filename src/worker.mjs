
const TIMEZONE = "Asia/Tehran";
const GOLD_URL = "https://www.tgju.org/profile/geram18";
const TETHER_URL = "https://www.tgju.org/profile/crypto-tether";

async function telegram(env, method, data = {}) {
  if (!env.BOT_TOKEN) throw new Error("BOT_TOKEN not configured");
  const response = await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/" + method, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(12000)
  });
  const json = await response.json();
  if (!response.ok || !json.ok) throw new Error("Telegram " + method + ": " + (json.description || response.status));
  return json.result;
}
const MENU_KEYBOARD = {
  keyboard: [
    [{text: "🚀 شروع"}],
    [{text: "💰 قیمت"}, {text: "🌤 آب و هوا"}],
    [{text: "📰 اخبار"}, {text: "💬 پشتیبان"}],
    [{text: "📚 منابع"}]
  ],
  resize_keyboard: true,
  is_persistent: true,
  input_field_placeholder: "یکی از گزینه‌های رصدینو را انتخاب کن"
};
async function send(env, chatId, text) {
  return telegram(env, "sendMessage", {
    chat_id: chatId, text, disable_web_page_preview: true, reply_markup: MENU_KEYBOARD
  });
}
function welcome() {
  return [
    "👋 به رصدینو | Rasadino خوش آمدی!",
    "",
    "📡 رصدینو دستیار هوشمند رصد اطلاعات و اعلان‌هاست.",
    "💰 با دکمه «قیمت» نرخ بیت‌کوین، تتر و طلای ۱۸ عیار و فهرست کالاهای مصرفی را ببین.",
    "🕙 گزارش خودکار بازار ساعت ۱۰ صبح و ۱۰ شب، فقط برای کاربران دارای اشتراک اعلان ارسال می‌شود.",
    "🌤 آب و هوای ۶ شهر منتخب و 📰 اخبار استان گلستان آماده‌اند.",
    "📚 برای دیدن منابع قیمت و هواشناسی، دکمه «منابع» را بزن.",
    "💬 برای ارتباط با مدیر، دکمه «پشتیبان» را انتخاب کن.",
    "",
    "👇 از دکمه‌های ثابت پایین صفحه استفاده کن."
  ].join("\n");
}

/* Selected Golestan cities; public Open-Meteo model coordinates for city centers. */
const GOLESTAN_CITIES = Object.freeze([
  {id:"bandargaz", name:"بندرگز", latitude:36.77200, longitude:53.94810},
  {id:"kordkuy", name:"کردکوی", latitude:36.79307, longitude:54.11214},
  {id:"gorgan", name:"گرگان", latitude:36.84270, longitude:54.44391},
  {id:"aqqala", name:"آق‌قلا", latitude:37.01390, longitude:54.45504},
  {id:"aliabad", name:"علی‌آباد کتول", latitude:36.91011, longitude:54.86737},
  {id:"gonbad", name:"گنبدکاووس", latitude:37.24930, longitude:55.16590}
]);
function weatherDescription(code) {
  const descriptions = {
    0:"☀️ صاف", 1:"🌤 عمدتاً صاف", 2:"⛅ نیمه‌ابری", 3:"☁️ ابری",
    45:"🌫 مه‌آلود", 48:"🌫 مه یخ‌زننده",
    51:"🌦 نم‌نم باران", 53:"🌦 نم‌نم باران", 55:"🌧 نم‌نم باران شدید",
    56:"🌧 باران یخ‌زننده", 57:"🌧 باران یخ‌زننده",
    61:"🌦 باران کم", 63:"🌧 باران", 65:"🌧 باران شدید",
    66:"🌧 باران یخ‌زننده", 67:"🌧 باران یخ‌زننده شدید",
    71:"🌨 برف سبک", 73:"🌨 برف", 75:"❄️ برف سنگین", 77:"❄️ دانه‌های برف",
    80:"🌦 رگبار سبک", 81:"🌧 رگبار", 82:"🌧 رگبار شدید",
    85:"🌨 رگبار برف", 86:"❄️ رگبار برف سنگین",
    95:"⛈ رعدوبرق", 96:"⛈ رعدوبرق و تگرگ", 99:"⛈ رعدوبرق و تگرگ شدید"
  };
  return descriptions[Number(code)] || "وضعیت نامشخص";
}
function weatherNumber(v, digits=0) {
  return typeof v === "number" && Number.isFinite(v)
    ? new Intl.NumberFormat("fa-IR",{maximumFractionDigits:digits}).format(v) : "نامشخص";
}
function goodTemp(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= -60 && v <= 65;
}
async function fetchCityForecast(city) {
  const query = new URLSearchParams({
    latitude:String(city.latitude), longitude:String(city.longitude),
    current:"temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m",
    daily:"weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_gusts_10m_max",
    timezone:"Asia/Tehran", forecast_days:"2", temperature_unit:"celsius",
    wind_speed_unit:"kmh", precipitation_unit:"mm"
  });
  const response = await fetch("https://api.open-meteo.com/v1/forecast?"+query, {
    headers:{"Accept":"application/json"},signal:AbortSignal.timeout(9000)
  });
  if(!response.ok) throw new Error("Open-Meteo HTTP " + response.status);
  const data = await response.json();
  if(data.timezone!=="Asia/Tehran" || !data.current || !data.daily ||
     !goodTemp(data.current.temperature_2m) || !Array.isArray(data.daily.time) ||
     data.daily.time.length < 2 || !goodTemp(data.daily.temperature_2m_min?.[0]) ||
     !goodTemp(data.daily.temperature_2m_max?.[0])) {
    throw new Error("Incomplete or invalid weather forecast for " + city.id);
  }
  const currentTime = Date.parse(data.current.time + "+03:30");
  if(!Number.isFinite(currentTime) || Math.abs(Date.now()-currentTime)>3*60*60*1000) {
    throw new Error("Stale weather model current timestamp for " + city.id);
  }
  return {city:city.name,current:data.current,daily:data.daily,updatedAt:data.current.time};
}
async function getWeatherReport(env) {
  const cacheKey = "weather:golestan:6cities:v2";
  try {
    const cached = await env.STATE.get(cacheKey);
    if(cached) return cached;
  }catch(e){ console.log("Weather KV read skipped: "+String(e)); }
  const results = await Promise.all(GOLESTAN_CITIES.map(async city=>{
    try { return await fetchCityForecast(city); }
    catch(e) { console.log("Weather fetch "+city.id+": "+String(e)); return {city:city.name,error:true}; }
  }));
  const stamp = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    timeZone:"Asia/Tehran",dateStyle:"medium",timeStyle:"short"
  }).format(new Date());
  const rows = ["🌤 هواشناسی ۶ شهر منتخب استان گلستان","🗓 "+stamp,""];
  for(const data of results){
    rows.push("📍 "+data.city);
    if(data.error){
      rows.push("داده معتبر هواشناسی در دسترس نیست.","");
      continue;
    }
    const c=data.current, d=data.daily;
    rows.push("اکنون: "+weatherDescription(c.weather_code)+" | "+weatherNumber(c.temperature_2m,1)+"°C"+
      " (احساسی "+weatherNumber(c.apparent_temperature,1)+"°C)");
    rows.push("رطوبت: "+weatherNumber(c.relative_humidity_2m)+"٪ | باد: "+weatherNumber(c.wind_speed_10m)+" km/h");
    for(let day=0;day<2;day++){
      rows.push((day===0?"امروز":"فردا")+": "+weatherDescription(d.weather_code?.[day])+
        " | "+weatherNumber(d.temperature_2m_min?.[day],1)+" تا "+weatherNumber(d.temperature_2m_max?.[day],1)+"°C"+
        " | احتمال بارش تا "+weatherNumber(d.precipitation_probability_max?.[day])+"٪"+
        " | بارش "+weatherNumber(d.precipitation_sum?.[day],1)+" mm");
    }
    rows.push("");
  }
  const report = rows.join("\n");
  if(results.some(x=>!x.error)){
    try {await env.STATE.put(cacheKey,report,{expirationTtl:600});}
    catch(e){console.log("Weather KV write skipped: "+String(e));}
  }
  return report;
}


function cityWeatherKeyboard() {
  const inline_keyboard = [];
  for(let i=0;i<GOLESTAN_CITIES.length;i+=2) {
    inline_keyboard.push(GOLESTAN_CITIES.slice(i,i+2).map(city=>({
      text:"🌤 "+city.name, callback_data:"weather:"+city.id
    })));
  }
  inline_keyboard.push([{text:"🏠 منوی اصلی",callback_data:"main:menu"}]);
  return {inline_keyboard};
}
async function sendWeatherMenu(env,chatId) {
  return telegram(env,"sendMessage",{
    chat_id:chatId,
    text:"🌤 آب‌وهوای ۶ شهر منتخب گلستان\n\n👇 شهر موردنظر را انتخاب کن تا پیش‌بینی همان شهر نمایش داده شود.",
    reply_markup:cityWeatherKeyboard()
  });
}
async function singleCityWeather(env,cityId) {
  const city = GOLESTAN_CITIES.find(c=>c.id===cityId);
  if(!city) return "شهر انتخاب‌شده معتبر نیست.";
  let data;
  const key="weather:city:"+city.id+":v2";
  try {const cached=await env.STATE.get(key);
    if(cached) data=JSON.parse(cached);
  } catch(e) {console.log("weather cache read: "+String(e));}
  if(!data) {
    try {
      data=await fetchCityForecast(city);
      await env.STATE.put(key,JSON.stringify(data),{expirationTtl:300});
    } catch(e) {
      console.log("weather single city unavailable: "+String(e.message));
      return "⚠️ اطلاعات به‌روز "+city.name+" فعلاً در دسترس نیست؛ لطفاً کمی بعد دوباره امتحان کن.";
    }
  }
  const c=data.current,d=data.daily;
  const time=new Intl.DateTimeFormat("fa-IR",{timeZone:TIMEZONE,hour:"2-digit",minute:"2-digit"}).format(new Date(data.updatedAt+"+03:30"));
  return [
    "🌤 آب‌وهوای "+city.name,
    "🕒 وضعیت ساعت "+time+" (ایران)",
    "",
    weatherDescription(c.weather_code)+" | "+weatherNumber(c.temperature_2m,1)+"°C",
    "🌡 دمای احساسی: "+weatherNumber(c.apparent_temperature,1)+"°C",
    "💧 رطوبت: "+weatherNumber(c.relative_humidity_2m)+"٪ | 💨 باد: "+weatherNumber(c.wind_speed_10m)+" کیلومتر/ساعت",
    "",
    "📅 امروز: "+weatherNumber(d.temperature_2m_min?.[0],1)+" تا "+weatherNumber(d.temperature_2m_max?.[0],1)+"°C"+
      " | 🌧 احتمال بارش "+weatherNumber(d.precipitation_probability_max?.[0])+"٪",
    "📅 فردا: "+weatherNumber(d.temperature_2m_min?.[1],1)+" تا "+weatherNumber(d.temperature_2m_max?.[1],1)+"°C"+
      " | 🌧 احتمال بارش "+weatherNumber(d.precipitation_probability_max?.[1])+"٪",
    ""
  ].join("\n");
}

/* Public user registry. Store only the Telegram chat ID (as KV key) and opt-in state. */
const USER_PREFIX = "user:";
function userKey(chatId) {
  const id = String(chatId);
  if (!/^\d{1,20}$/.test(id)) throw new Error("Invalid private chat ID");
  return USER_PREFIX + id;
}
async function readUser(env, chatId) {
  const raw = await env.STATE.get(userKey(chatId));
  if (!raw) return null;
  try {
    const item = JSON.parse(raw);
    return item && typeof item.notifications_enabled === "boolean" ? item : null;
  } catch (_) {
    return null;
  }
}
async function registerUser(env, chatId) {
  const previous = await readUser(env, chatId);
  if (previous) return previous;
  const owner = await env.STATE.get("owner_chat_id");
  const item = {
    notifications_enabled: owner === String(chatId),
    created_at: new Date().toISOString(),
  };
  await env.STATE.put(userKey(chatId), JSON.stringify(item), {
    metadata: {notifications_enabled: item.notifications_enabled}
  });
  return item;
}
async function setUserNotifications(env, chatId, enabled) {
  const previous = await registerUser(env, chatId);
  const item = {...previous, notifications_enabled: Boolean(enabled)};
  await env.STATE.put(userKey(chatId), JSON.stringify(item), {
    metadata: {notifications_enabled: item.notifications_enabled}
  });
  return item;
}
async function* notificationTargets(env) {
  const owner = await env.STATE.get("owner_chat_id");
  let ownerRegistered = false;
  let cursor;
  do {
    const page = await env.STATE.list({
      prefix: USER_PREFIX,
      limit: 1000,
      ...(cursor ? {cursor} : {})
    });
    for (const key of page.keys || []) {
      const id = key.name.slice(USER_PREFIX.length);
      if (!/^\d{1,20}$/.test(id)) continue;
      if (id === owner) ownerRegistered = true;
      let enabled = key.metadata?.notifications_enabled;
      if (typeof enabled !== "boolean") {
        enabled = (await readUser(env, id))?.notifications_enabled === true;
      }
      if (enabled) yield id;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  // Preserve previously scheduled messages for the verified owner until they
  // explicitly opt out. Never override an owner's recorded opt-out.
  if (owner && !ownerRegistered && /^\d{1,20}$/.test(owner)) yield owner;
}
async function deliverScheduledReport(env, chatId, owner, slot, message) {
  const key = "sent:" + slot + ":" + chatId;
  if (await env.STATE.get(key)) return false;
  const legacyKey = "sent:" + slot;
  if (chatId === owner && await env.STATE.get(legacyKey)) return false;
  try {
    await send(env, chatId, message);
    await env.STATE.put(key, "1", {expirationTtl: 172800});
    if (chatId === owner) {
      await env.STATE.put(legacyKey, "1", {expirationTtl: 172800});
    }
    return true;
  } catch (error) {
    // A blocked/deactivated chat must not affect deliveries to other users.
    const detail = String(error?.message || error);
    if (/bot was blocked|user is deactivated|chat not found|forbidden/i.test(detail)) {
      await setUserNotifications(env, chatId, false);
    }
    console.log("Rasadino scheduled recipient delivery failed");
    return false;
  }
}

async function onCallbackQuery(query,env) {
  if(!query || typeof query.data!=="string" || !query.id) return;
  const chatId=String(query.message?.chat?.id||"");
  if (!/^\d{1,20}$/.test(chatId) || query.message?.chat?.type !== "private" || String(query.from?.id) !== chatId) {
    await telegram(env,"answerCallbackQuery",{callback_query_id:query.id,text:"درخواست نامعتبر است.",show_alert:true});
    return;
  }
  await registerUser(env,chatId);
  try { await telegram(env,"answerCallbackQuery",{callback_query_id:query.id}); }
  catch(e) { console.log("Telegram callback acknowledgement: "+String(e.message)); }
  if(query.data==="main:menu") {
    await send(env,chatId,welcome());
  } else if(query.data==="prices:goods") {
    await sendConsumerPrices(env,chatId);
  } else if(query.data==="prices:markets") {
    await sendMarketPrice(env,chatId);
  } else if(query.data==="prices:sources") {
    await send(env,chatId,await sourcesMessage(env));
  } else if (/^news:view:[0-9a-z]{8,12}:[01]$/.test(query.data)) {
    const parts=query.data.split(":");
    const snapshot=await readNewsView(env,parts[2]);
    if (snapshot) await sendNewsSnapshotPage(env,chatId,snapshot,Number(parts[3]));
    else await sendGolestanNews(env,chatId,false,0);
  } else if (/^news:detail:[0-9a-z]{8,12}:[1-9a]$/.test(query.data)) {
    const parts=query.data.split(":");
    try { await sendNewsDetail(env,chatId,parts[2],parseInt(parts[3],36)); }
    catch(e) { console.log("News detail delivery failed: "+String(e.message));
      await send(env,chatId,"⚠️ نمایش جزئیات این خبر با مشکل مواجه شد. لطفاً دوباره دکمه اخبار را بزن.");
    }
  } else if(query.data==="news:page:1") {
    await sendGolestanNews(env,chatId,false,1);
  } else if(query.data==="news:page:0") {
    await sendGolestanNews(env,chatId,false,0);
  } else if(query.data==="news:refresh") {
    await sendGolestanNews(env,chatId,true,0);
  } else if(query.data==="weather:menu") {
    await sendWeatherMenu(env,chatId);
  } else if(/^weather:page:[0-3]$/.test(query.data)) {
    // Compatibility with previously sent, four-page inline keyboards.
    await sendWeatherMenu(env,chatId);
  } else if(query.data.startsWith("weather:") && GOLESTAN_CITIES.some(city=>query.data==="weather:"+city.id)) {
    const weatherText=await singleCityWeather(env,query.data.slice(8));
    await telegram(env,"sendMessage",{chat_id:chatId,text:weatherText,reply_markup:{
      inline_keyboard: [
        [{text:"🔁 انتخاب شهر دیگر",callback_data:"weather:menu"}],
        [{text:"🏠 بازگشت به منو",callback_data:"main:menu"}]
      ]
    }});
  } else if(/^weather:[a-z][a-z0-9]{1,23}$/.test(query.data)) {
    // Old Telegram messages may contain cities removed from the selection.
    await sendWeatherMenu(env,chatId);
  }
}
async function onUpdate(update,env) {
  if(update.callback_query) return onCallbackQuery(update.callback_query,env);
  return onTelegram(update,env);
}


/* Daily Golestan headline digest. Collect published RSS headlines only, never invent articles. */
const NEWS_KV_KEY = "news:golestan:v3";
const NEWS_SOURCES = Object.freeze([
  {name:"خبرپو ـ گلستان",url:"https://khabarpu.com/tags/provinces/golestan/golestan-news.html",parser:"khabarpu"},
  {name:"خبر فارسی ـ گلستان",url:"https://khabarfarsi.com/city/1575",parser:"khabarfarsi"},
  {name:"خبرگزاری مهر",url:"https://www.mehrnews.com/rss"},
  {name:"ایسنا",url:"https://www.isna.ir/rss"},
  {name:"خبرآنلاین",url:"https://www.khabaronline.ir/rss"},
  {name:"عصر ایران",url:"https://www.asriran.com/fa/rss/allnews"},
  {name:"پرسون ـ گلستان",url:"https://purson.ir/fa/rss/service/1408/Golestan",provincial:true}
]);
// All 14 Golestan counties; a discovery glossary of cities and named villages.
// These are matches in *published source feeds*, not independent searches across every village.
const NEWS_COUNTIES = [
  "گرگان","گنبدکاووس","گنبد کاووس","آق قلا","آق‌قلا","علی آباد کتول","علی‌آباد کتول",
  "کردکوی","بندرگز","بندر گز","بندرترکمن","بندر ترکمن","مینودشت",
  "گالیکش","کلاله","آزادشهر","رامیان","گمیشان","مراوه تپه","مراوه‌تپه"
];
const NEWS_SETTLEMENTS = [
  "فاضل آباد","فاضل‌آباد","خان ببین","خان‌ببین","دلند","اینچه برون","اینچه‌برون",
  "نوکنده","سیمین شهر","سیمین‌شهر","نگین شهر","نگین‌شهر","تاتار علیا",
  "فراغی","داشلی برون","داشلی‌برون","سرخنکلاته","نوده خاندوز","نوده‌خاندوز",
  "صادق آباد","صادق‌آباد","دوزین","مزرعه کتول","قرق","جلین","زیارت",
  "سنگدوین","النگ","بالاجاده","سرکلاته","مهترکلاته","لیوان","لیوان شرقی",
  "لیوان غربی","سیجوال","پنج پیکر","آشوراده","توسکستان","جهان نما",
  "جهان‌نما","روستای قورچای","یلمه سالیان","پیش کمر","پیش‌کمر","تمرقره قوزی",
  "حاجی قوشان","گلیداغ","قلعه قافه","قلعه‌قافه","چین سبیلی","قره چشمه",
  "نودیجه","نصرآباد","زینب آباد","سرخ چشمه","قزلجه","چهارده"
];
function plainNewsText(s) {
  return String(s||"").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1")
    .replace(/<[^>]+>/g," ").replace(/&amp;/g,"&").replace(/&quot;/g,'"')
    .replace(/&apos;|&#39;|&#x27;/gi,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">")
    .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Math.min(0x10ffff,Number(n))))
    .replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(Math.min(0x10ffff,parseInt(n,16))))
    .replace(/\s+/g," ").trim();
}
function regionalNormalize(s){
  return plainNewsText(s).replace(/[يى]/g,"ی").replace(/ك/g,"ک").replace(/[\u200c\u200f]/g," ").replace(/\s+/g," ").toLowerCase();
}
function newsTag(xml, tag) {
  const patterns = {
    title: /<title\b[^>]*>([\s\S]*?)<\/title>/i,
    link: /<link\b[^>]*>([\s\S]*?)<\/link>/i,
    description: /<description\b[^>]*>([\s\S]*?)<\/description>/i,
    summary: /<summary\b[^>]*>([\s\S]*?)<\/summary>/i,
    pubDate: /<pubDate\b[^>]*>([\s\S]*?)<\/pubDate>/i,
    published: /<published\b[^>]*>([\s\S]*?)<\/published>/i,
    updated: /<updated\b[^>]*>([\s\S]*?)<\/updated>/i,
    "dc:date": /<dc:date\b[^>]*>([\s\S]*?)<\/dc:date>/i
  };
  const match = xml.match(patterns[tag] || /(?!)_/);
  return match ? plainNewsText(match[1]) : "";
}
function safeArticleLink(raw){
  try{
    const u=new URL(String(raw||"").trim());
    return u.protocol==="https:" || u.protocol==="http:" ? u.toString() : null;
  }catch(_){return null;}
}
function newsLocalTerms(text){
  const s=regionalNormalize(text);
  const hits = NEWS_COUNTIES.filter(n=>s.includes(regionalNormalize(n)));
  if(hits.length) return hits.slice(0,3);
  const village=NEWS_SETTLEMENTS.filter(n=>s.includes(regionalNormalize(n)));
  return village.length ? village.slice(0,3) : [];
}
function isGolestanStory(title, description, source) {
  // For national feeds require evidence in the title, not an unrelated mention in RSS body.
  const t = regionalNormalize(title);
  const d = regionalNormalize(description);
  const county = NEWS_COUNTIES.some(n=>t.includes(regionalNormalize(n)));
  const village = NEWS_SETTLEMENTS.some(n=>{
    const normalized=regionalNormalize(n);
    return normalized.length>=6 && t.includes(normalized);
  });
  const province = t.includes("استان گلستان") || t.includes("استانی گلستان") ||
    (t.includes("گلستان") && !t.includes("شهر گلستان") &&
     !t.includes("شهرستان گلستان") && !t.includes("پارک ملی گلستان"));
  if (province || county) return true;
  if (village && (d.includes("گلستان") || source.provincial || source.searchSource)) return true;
  return false;
}
function parseNewsFeed(xml,source){
  if(!/<(rss|feed)\b/i.test(xml))throw new Error("Invalid RSS/Atom feed: "+source.name);
  const blocks=xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi)
    || xml.match(/<entry\b[^>]*>[\s\S]*?<\/entry>/gi) || [];
  const items=[];
  const now=Date.now();
  for(const block of blocks.slice(0,130)){
    const title=newsTag(block,"title");
    let link=newsTag(block,"link");
    if(!link){
      const m=block.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i);
      if(m)link=plainNewsText(m[1]);
    }
    const desc=newsTag(block,"description")||newsTag(block,"summary");
    const dateText=newsTag(block,"pubDate")||newsTag(block,"published")||newsTag(block,"updated")||newsTag(block,"dc:date");
    const dateMs=Date.parse(dateText);
    const url=safeArticleLink(link);
    if(!title || !url || !Number.isFinite(dateMs) || dateMs>now+7200000 ||
       dateMs<now-NEWS_WINDOW_MS || !isGolestanStory(title,desc,source))continue;
    const region=newsLocalTerms(title+" "+desc);
    const ageDays=(now-dateMs)/86400000;
    const topics=/(سیل|زلزله|تلفات|هشدار|تصادف|راه|بیمارستان|بهداشت|درمان|آب رسانی|آبرسانی|تعطیل|اشتغال|کشاورزی|مدرسه|محیط زیست|قاچاق|قضایی|تورم|بارش|سوخت|قیمت)/.test(title);
    items.push({
      title:title.slice(0,220),url,source:(source.searchSource ? "گوگل نیوز / " + (plainNewsText((block.match(/<source\b[^>]*>([\s\S]*?)<\/source>/i)||[])[1]) || "سرویس خبری") : source.name),date:new Date(dateMs).toISOString(),
      county:region[0]||"استان گلستان",score:(source.provincial?2:0)+(topics?3:0)+Math.max(0,7-ageDays)
    });
  }
  return items;
}
async function scanNewsSource(source){
  if(source.parser)return scanNewsHtml(source);
  const res=await fetch(source.url,{
    headers:{"Accept":"application/rss+xml, application/atom+xml, text/xml, application/xml;q=0.8,*/*;q=0.2"},
    signal:AbortSignal.timeout(10000)
  });
  if(!res.ok)throw new Error(source.name+" HTTP "+res.status);
  const xml=(await res.text()).slice(0,1200000);
  return parseNewsFeed(xml,source);
}

const NEWS_WINDOW_MS = 48 * 60 * 60 * 1000;
function newsParseRelativeTime(text, capturedAt=Date.now()) {
  const fa="۰۱۲۳۴۵۶۷۸۹", ar="٠١٢٣٤٥٦٧٨٩";
  const normalized=plainNewsText(text)
    .replace(/[۰-۹]/g,c=>String(fa.indexOf(c)))
    .replace(/[٠-٩]/g,c=>String(ar.indexOf(c)));
  if (/لحظاتی\s*پیش|همین\s*الان/.test(normalized)) {
    return {timestamp:new Date(capturedAt).toISOString(), approximate:true};
  }
  const m=normalized.match(/(\d{1,3})\s*(دقیقه|ساعت|روز)\s*پیش/);
  if(!m)return null;
  const n=Number(m[1]),factor=m[2]==="دقیقه"?60000:m[2]==="ساعت"?3600000:86400000;
  if(n<0 || n*factor>=NEWS_WINDOW_MS)return null;
  return {timestamp:new Date(capturedAt-n*factor).toISOString(),approximate:true};
}
function newsDirectLink(href,base) {
  try {
    const url=new URL(href,base);
    if(!["https:","http:"].includes(url.protocol))return null;
    if(url.hostname.endsWith(".local")||url.hostname==="localhost")return null;
    return url.href;
  } catch (_) {return null;}
}
function newsHtmlEntry({title,url,sourceName,sourceUrl,relative,description=""},now) {
  const parsed=newsParseRelativeTime(relative,now);
  const cleanTitle=plainNewsText(title);
  const cleanDescription=plainNewsText(description);
  const link=newsDirectLink(url,sourceUrl);
  if(!parsed||!link||cleanTitle.length<22||cleanTitle.length>230||
     !isGolestanStory(cleanTitle,cleanDescription,{provincial:true}))return null;
  const tags=newsLocalTerms(cleanTitle+" "+cleanDescription);
  const priority=/(هشدار|حادثه|تصادف|سیلاب|زلزله|آتش|بحران|قطعی|تعطیل|بازداشت|آب|جاده|راه|توزیع|آبرسانی|سلامت|درمان|بیمارستان|اقتصاد|کشاورزی|طرح|خسارت|تولید|صادرات|بودجه|اشتغال)/.test(cleanTitle);
  const ageHours=(now-Date.parse(parsed.timestamp))/3600000;
  return {
    title:cleanTitle.slice(0,220),url:link,source:sourceName||"گردآورنده اخبار استان",
    date:parsed.timestamp, approximateTime:true,
    county:tags[0]||"استان گلستان",score:8+(priority?4:0)+Math.max(0,2-ageHours/24)
  };
}
function parseKhabarpuNews(html,source,now=Date.now()) {
  const items=[];
  const blocks=html.match(/<li\b[^>]*>[\s\S]*?<\/li>/gi)||[];
  for(const block of blocks.slice(0,300)){
    if(!/(دقیقه|ساعت|روز)\s*پیش/.test(plainNewsText(block)))continue;
    const links=[...block.matchAll(/<a\b[^>]*\bhref=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)];
    const main=links.find(m=>plainNewsText(m[3]).length>=22);
    if(!main)continue;
    const p=plainNewsText(block);
    const stamp=p.match(/(?:\d+|[۰-۹٠-٩]+)\s*(?:دقیقه|ساعت|روز)\s*پیش/)?.[0];
    if(!stamp)continue;
    const publisher=(p.match(/\/\s*([^\/]{2,42}?)\s*-\s*(?:\d+|[۰-۹٠-٩]+)\s*(?:دقیقه|ساعت|روز)\s*پیش/)||[])[1];
    const item=newsHtmlEntry({
      title:main[3],url:main[2],
      sourceName:publisher?plainNewsText(publisher):"خبرپو (تجمیع)",
      sourceUrl:source.url,relative:stamp
    },now);
    if(item)items.push(item);
    if(items.length>=60)break;
  }
  return items;
}
function parseKhabarfarsiNews(html,source,now=Date.now()) {
  const items=[];
  const headings=[...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)].slice(0,140);
  for(let i=0;i<headings.length;i++){
    const h=headings[i],tag=h[1];
    const link=tag.match(/<a\b[^>]*\bhref=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/i);
    if(!link)continue;
    const nextHead=headings[i+1]?.index??html.length;
    const next=html.slice(h.index+h[0].length,Math.min(nextHead,h.index+h[0].length+1800));
    const text=plainNewsText(next);
    const stamp=text.match(/(?:\d+|[۰-۹٠-٩]+)\s*(?:دقیقه|ساعت|روز)\s*پیش/)?.[0];
    if(!stamp)continue;
    const publisher=text.match(/^([^•\n]{2,55}?)\s*(?:\d+|[۰-۹٠-٩]+)\s*(?:دقیقه|ساعت|روز)\s*پیش/);
    const item=newsHtmlEntry({
      title:link[3],url:link[2],
      sourceName:publisher?plainNewsText(publisher[1]):"خبر فارسی (تجمیع)",
      sourceUrl:source.url,relative:stamp,description:text.slice(0,300)
    },now);
    if(item)items.push(item);
    if(items.length>=65)break;
  }
  return items;
}
async function scanNewsHtml(source) {
  const response=await fetch(source.url,{
    headers:{Accept:"text/html", "User-Agent":"Mozilla/5.0 (compatible; Rasadino/1.2)"},
    signal:AbortSignal.timeout(7500)
  });
  if(!response.ok)throw new Error(source.name+" HTTP "+response.status);
  const html=(await response.text()).slice(0,1800000);
  if(!/<html\b/i.test(html)&&!/<h2\b/i.test(html))throw new Error("Non-HTML source: "+source.name);
  return source.parser==="khabarpu"
    ?parseKhabarpuNews(html,source):parseKhabarfarsiNews(html,source);
}

function normalizeHeadline(t){
  return regionalNormalize(t).replace(/[^\p{L}\p{N}\s]/gu,"").replace(/\s+/g," ").trim();
}
function isDuplicateNews(a,b){
  const aa=normalizeHeadline(a.title),bb=normalizeHeadline(b.title);
  if(aa===bb) return true;
  const aWords=new Set(aa.split(" ").filter(w=>w.length>=3));
  const bWords=new Set(bb.split(" ").filter(w=>w.length>=3));
  if(aWords.size<4 || bWords.size<4)return false;
  let common=0;for(const word of aWords)if(bWords.has(word))common++;
  return common/Math.min(aWords.size,bWords.size)>=0.83;
}
function rankGolestanNews(items) {
  const now=Date.now();
  const valid=items.filter(x=>x && Number.isFinite(Date.parse(x.date)) &&
    Date.parse(x.date)>=now-NEWS_WINDOW_MS && Date.parse(x.date)<=now+300000 &&
    typeof x.title==="string" && x.title.length>20 && safeArticleLink(x.url) &&
    isGolestanStory(x.title,"",{provincial:false}));
  const sorted=valid.sort((a,b)=>(b.score||0)-(a.score||0) ||
    Date.parse(b.date)-Date.parse(a.date));
  const unique=[];
  for(const item of sorted){
    if(unique.some(x=>isDuplicateNews(x,item)))continue;
    unique.push(item);
  }
  const selected=[],areas=new Set();
  for(const item of unique) {
    if(selected.length>=10)break;
    const area=regionalNormalize(item.county);
    if(area==="استان گلستان"||areas.has(area))continue;
    selected.push(item);areas.add(area);
  }
  for(const item of unique) {
    if(selected.length>=10)break;
    if(!selected.includes(item))selected.push(item);
  }
  return selected.sort((a,b)=>(b.score||0)-(a.score||0) ||
    Date.parse(b.date)-Date.parse(a.date));
}

async function refreshGolestanNews(env){
  const responses=await Promise.allSettled(NEWS_SOURCES.map(scanNewsSource));
  const all=[]; const sourceStats=[];
  for(let i=0;i<responses.length;i++){
    const v=responses[i];
    if(v.status==="fulfilled"){
      all.push(...v.value);sourceStats.push({name:NEWS_SOURCES[i].name,ok:true,count:v.value.length});
    } else {
      console.log("News source unavailable "+NEWS_SOURCES[i].name+": "+String(v.reason));
      sourceStats.push({name:NEWS_SOURCES[i].name,ok:false,count:0});
    }
  }
  const result={updatedAt:new Date().toISOString(),sourceStats,items:rankGolestanNews(all)};
  if(result.items.length>0) {
    await env.STATE.put(NEWS_KV_KEY,JSON.stringify(result));
  }
  await env.STATE.put("news:golestan:last_scan",JSON.stringify({
    scannedAt:result.updatedAt,successfulSources:sourceStats.filter(x=>x.ok).length,
    itemCount:result.items.length,windowHours:48,sourceStats
  }),{expirationTtl:7*86400});
  return result;
}
async function getGolestanNews(env,{force=false}={}) {
  // Always scan live sources when users tap "News" or "Refresh".
  // The cache exists for historical inline-button detail views, not for skipping new scans.
  let last=null;
  try {const raw=await env.STATE.get(NEWS_KV_KEY);if(raw)last=JSON.parse(raw);}
  catch(e){console.log("News cache read failed: "+String(e));}
  if(!force && last && Date.now()-Date.parse(last.updatedAt)<2*3600000) {
    return {...last,items:last.items.filter(x=>Date.parse(x.date)>=Date.now()-NEWS_WINDOW_MS)};
  }
  try {
    const fresh=await refreshGolestanNews(env);
    if(fresh.items.length>0)return fresh;
  } catch(e) { console.log("Golestan on-demand scan failed: "+String(e)); }
  // Do not misrepresent old or irrelevant news. A recent verified cache may be used
  // only as a clearly marked fallback, always restricted to the last 48 hours.
  const recent=last?.items?.filter(x=>Number.isFinite(Date.parse(x.date)) &&
    Date.now()-Date.parse(x.date)<=NEWS_WINDOW_MS && Date.parse(x.date)<=Date.now()+300000) || [];
  const cacheAge=last ? Date.now()-Date.parse(last.updatedAt):Infinity;
  return recent.length && cacheAge<3600000
    ? {...last,items:recent,stale:true} : null;
}

function persianDateNews(value){
  return new Intl.DateTimeFormat("fa-IR-u-ca-persian",{
    timeZone:TIMEZONE,year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"
  }).format(new Date(value));
}
function newsTimeLabel(item) {
  return (item.approximateTime?"حدود ":"")+persianDateNews(item.date);
}

function newsViewId(snapshot) {
  const stamp = Date.parse(snapshot?.updatedAt || "");
  return Number.isFinite(stamp) ? stamp.toString(36) : null;
}
async function persistNewsView(env, snapshot) {
  if (!snapshot?.items?.length) return null;
  const id = newsViewId(snapshot);
  if (!id) return null;
  await env.STATE.put("news:view:" + id, JSON.stringify(snapshot), {expirationTtl: 604800});
  return id;
}
async function readNewsView(env, id) {
  if (!/^[0-9a-z]{8,12}$/.test(id)) return null;
  const raw = await env.STATE.get("news:view:" + id);
  if (!raw) return null;
  try {
    const snapshot = JSON.parse(raw);
    return snapshot?.items && newsViewId(snapshot) === id ? snapshot : null;
  } catch (_) { return null; }
}
function makeNewsMessage(snapshot, page=0, viewId=null) {
  const fallbackKeyboard = [
    [{text:"🔄 بررسی دوباره خبرها", callback_data:"news:refresh"}],
    [{text:"🏠 منوی اصلی", callback_data:"main:menu"}]
  ];
  if (!snapshot?.items?.length) {
    return {
      text:"📰 اخبار استان گلستان\n\n⚠️ در حال حاضر تیتر خبری قابل‌تأیید در دسترس نیست.",
      inline_keyboard:fallbackKeyboard
    };
  }
  const pageNumber = page === 1 ? 1 : 0;
  const offset = pageNumber * 5;
  const items = snapshot.items.slice(offset, offset + 5);
  if (!items.length) {
    return {text:"📰 خبر بیشتری موجود نیست.", inline_keyboard:[
      [{text:"⬅️ بازگشت به پنج خبر اول", callback_data:viewId ? "news:view:"+viewId+":0" : "news:page:0"}],
      [{text:"🏠 منوی اصلی", callback_data:"main:menu"}]
    ]};
  }
  const lines = [
    "📰 اخبار استان گلستان — ۴۸ ساعت اخیر" + (pageNumber ? " | صفحه دوم" : ""),
    snapshot.stale ? "⚠️ این فهرست مربوط به آخرین گردآوری موفق است." : "",
    ""
  ].filter(Boolean);
  const keyboard = [];
  items.forEach((item, i) => {
    const number = offset + i + 1;
    // Title only: date, publisher and full URL are available on demand.
    lines.push(number + "️⃣ " + item.title.slice(0, 180));
    lines.push("");
    keyboard.push([{
      text:"🔎 جزئیات خبر " + new Intl.NumberFormat("fa-IR").format(number),
      callback_data:viewId ? "news:detail:"+viewId+":"+number.toString(36) : "news:refresh"
    }]);
  });
  lines.push("👇 برای تاریخ انتشار، منبع و لینک هر خبر، «جزئیات خبر» را بزن.");
  if (pageNumber === 0 && snapshot.items.length > 5) {
    const remaining = Math.min(10, snapshot.items.length) - 5;
    keyboard.push([{
      text:"📰 خبرهای بیشتر ("+new Intl.NumberFormat("fa-IR").format(remaining)+" خبر)",
      callback_data:viewId ? "news:view:"+viewId+":1" : "news:page:1"
    }]);
  }
  if (pageNumber === 1) {
    keyboard.push([{text:"⬅️ پنج خبر اول", callback_data:viewId ? "news:view:"+viewId+":0" : "news:page:0"}]);
  }
  keyboard.push([{text:"🔄 به‌روزرسانی خبرها", callback_data:"news:refresh"}]);
  keyboard.push([{text:"🏠 منوی اصلی", callback_data:"main:menu"}]);
  return {text:lines.join("\n").slice(0,3900), inline_keyboard:keyboard};
}
async function sendNewsSnapshotPage(env, chatId, snapshot, page=0) {
  const viewId = await persistNewsView(env,snapshot);
  const news = makeNewsMessage(snapshot,page,viewId);
  return telegram(env, "sendMessage", {
    chat_id:chatId, text:news.text, disable_web_page_preview:true,
    reply_markup:{inline_keyboard:news.inline_keyboard}
  });
}
async function sendGolestanNews(env, chatId, force=false, page=0) {
  return sendNewsSnapshotPage(env,chatId,await getGolestanNews(env,{force}),page);
}
async function sendNewsDetail(env, chatId, viewId, relativeIndex) {
  const snapshot = await readNewsView(env,viewId);
  if (!snapshot) {
    return telegram(env,"sendMessage",{
      chat_id:chatId,
      text:"⌛ این فهرست خبری منقضی شده است. برای دیدن خبرهای تازه، دکمه زیر را بزن.",
      reply_markup:{inline_keyboard:[
        [{text:"📰 تازه‌ترین خبرها",callback_data:"news:refresh"}],
        [{text:"🏠 منوی اصلی",callback_data:"main:menu"}]
      ]}
    });
  }
  const absolute = relativeIndex - 1;
  const item = snapshot.items[absolute];
  if (!item || absolute < 0 || absolute >= 10) {
    return sendNewsSnapshotPage(env,chatId,snapshot,0);
  }
  const page = absolute >= 5 ? 1 : 0;
  const number = absolute + 1;
  const url = safeArticleLink(item.url);
  const lines = [
    "📰 جزئیات خبر "+new Intl.NumberFormat("fa-IR").format(number),
    "",
    "📝 عنوان: "+item.title,
    "🗓 زمان انتشار: "+newsTimeLabel(item),
    "🗞 منبع: "+item.source,
    "📍 محدوده خبر: "+(item.county||"استان گلستان"),
    "",
    url ? "🔗 لینک مطالعه کامل:\n"+url : "🔗 لینک مطالعه کامل در دسترس نیست."
  ];
  const keyboard = [];
  if (url) keyboard.push([{text:"📖 مطالعه خبر در سایت منبع",url}]);
  keyboard.push([{text:"⬅️ بازگشت به فهرست خبرها",callback_data:"news:view:"+viewId+":"+page}]);
  keyboard.push([{text:"🏠 منوی اصلی",callback_data:"main:menu"}]);
  return telegram(env,"sendMessage",{
    chat_id:chatId,text:lines.join("\n").slice(0,3900),
    disable_web_page_preview:true,
    reply_markup:{inline_keyboard:keyboard}
  });
}


function latinNumber(s) {
  const fa = "۰۱۲۳۴۵۶۷۸۹", ar = "٠١٢٣٤٥٦٧٨٩";
  return String(s).replace(/[۰-۹]/g, c => fa.indexOf(c)).replace(/[٠-٩]/g, c => ar.indexOf(c))
    .replace(/[٬,\s]/g, "").replace(/٫/g, ".");
}
function toText(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi," ")
    .replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ");
}
async function tgjuRial(url, label) {
  const response = await fetch(url, {
    headers: {"Accept": "text/html", "User-Agent": "Mozilla/5.0 (compatible; PriceReportBot/1.0)"},
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error("TGJU " + response.status);
  const html = await response.text();
  if (html.length < 250) throw new Error("TGJU HTML empty");
  const text = toText(html);
  const pattern = label === "gold"
    ? /نرخ\s*فعلی\s*[:：]*\s*([0-9۰-۹٠-٩٬,.]+)/u
    : /قیمت\s*ریالی\s*[:：]*\s*([0-9۰-۹٠-٩٬,.]+)/u;
  const m = text.match(pattern);
  if (!m) throw new Error("TGJU price not found");
  const rial = Number(latinNumber(m[1]));
  if (!Number.isFinite(rial) || (label === "gold" && (rial < 1000000 || rial > 10000000000))
      || (label === "tether" && (rial < 10000 || rial > 100000000))) {
    throw new Error("TGJU invalid range");
  }
  return {value: rial / 10, source: "TGJU", url};
}
async function btcPrice() {
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd", {signal: AbortSignal.timeout(12000)});
    if (!r.ok) throw new Error("CoinGecko " + r.status);
    const j = await r.json();
    const value = Number(j?.bitcoin?.usd);
    if (!Number.isFinite(value) || value <= 0) throw new Error("Invalid BTC price");
    return {value, source: "CoinGecko"};
  } catch (_) {
    const r = await fetch("https://api.coinbase.com/v2/prices/BTC-USD/spot", {signal: AbortSignal.timeout(12000)});
    if (!r.ok) throw new Error("Coinbase " + r.status);
    const j = await r.json();
    const value = Number(j?.data?.amount);
    if (!Number.isFinite(value) || value <= 0) throw new Error("Invalid BTC fallback");
    return {value, source: "Coinbase"};
  }
}
async function quote(task) {
  try { return await task(); }
  catch (e) { console.log("Quote unavailable: " + String(e.message)); return {value: null, source: "unavailable"}; }
}

/* Consumer-item prices are editor-entered quotes with explicit provenance.
 * No exchange-rate feeds or shop HTML are repurposed as live item prices. */
const CONSUMER_GOODS = Object.freeze([
  {id:"saghe", name:"🍪 بیسکویت ساقه طلایی", hours:168},
  {id:"bread", name:"🥖 نان (نوع مشخص نشده)", hours:24},
  {id:"banana", name:"🍌 موز (هر کیلوگرم)", hours:24},
  {id:"codex12", name:"📦 کاندوم کدکس ۱۲ عددی (مدل مشخص نشده)", hours:168}
]);
function goodDefinition(id){return CONSUMER_GOODS.find(g=>g.id===id);}
function goodKey(id){return "good:quote:v1:"+id;}
function parsedGood(item,raw,now=Date.now()){
  if(!raw)return null;
  try {
    const p=JSON.parse(raw);
    const timestamp=Date.parse(p.updatedAt);
    if(!Number.isSafeInteger(p.toman)||p.toman<=0||p.toman>1000000000||
       typeof p.spec!=="string"||!p.spec.trim()||p.spec.length>100||
       typeof p.url!=="string"||!/^https:\/\/[^\s]+$/i.test(p.url)||
       !Number.isFinite(timestamp)||timestamp>now+900000||now-timestamp>item.hours*3600000)return null;
    return p;
  }catch(_){return null;}
}
async function goodQuotes(env){
  return Promise.all(CONSUMER_GOODS.map(async item=>{
    const raw=await env.STATE.get(goodKey(item.id));
    return {item,price:parsedGood(item,raw)};
  }));
}
function consumerGoodsText(rows) {
  const stamp= new Intl.DateTimeFormat("fa-IR-u-ca-persian",{
    timeZone:TIMEZONE,dateStyle:"medium",timeStyle:"short"
  });
  return [
    "🛒 قیمت کالاهای مصرفی",
    "",
    ...rows.map(({item,price})=>price
      ? item.name+"\n"+price.spec+": "+new Intl.NumberFormat("fa-IR").format(price.toman)+" تومان"+
        "\nآخرین ثبت: "+stamp.format(new Date(price.updatedAt))
      : item.name+"\nقیمت تأییدشده و به‌روز در دسترس نیست."),
    "",
    "ℹ️ نرخ‌های این بخش دستی ثبت می‌شوند، قیمت لحظه‌ای بازار نیستند؛ نوع و وزن کالا را با مشخصات ثبت‌شده تطبیق بده.",
    "📚 نشانی منابع فقط از دکمه «منابع» قابل مشاهده است."
  ].join("\n\n");
}
function priceInlineKeyboard(){
  return {inline_keyboard:[
    [{text:"🛒 قیمت کالاهای مصرفی",callback_data:"prices:goods"}],
    [{text:"📚 منابع",callback_data:"prices:sources"}]
  ]};
}
async function sendMarketPrice(env,chatId){
  return telegram(env,"sendMessage",{chat_id:chatId,text:report(await prices()),
    disable_web_page_preview:true,reply_markup:priceInlineKeyboard()});
}
async function sendConsumerPrices(env,chatId){
  return telegram(env,"sendMessage",{chat_id:chatId,text:consumerGoodsText(await goodQuotes(env)),
    disable_web_page_preview:true,reply_markup:{inline_keyboard:[
      [{text:"🔁 به‌روزرسانی",callback_data:"prices:goods"}],
      [{text:"💰 نرخ بیت‌کوین، تتر و طلا",callback_data:"prices:markets"}],
      [{text:"📚 منابع",callback_data:"prices:sources"}]
    ]}});
}
function goodUpdateFromCommand(line){
  const m=line.match(/^\/setgood(?:@\w+)?\s+(saghe|bread|banana|codex12)\s+([0-9]{1,10})\s*\|\s*([^|\r\n]{4,100})\s*\|\s*(https:\/\/[^\s|]{5,400})\s*$/i);
  if(!m)return null;
  const toman=Number(m[2]);const spec=m[3].trim();let url;
  try {url=new URL(m[4]);}
  catch(_){return null;}
  if(!Number.isSafeInteger(toman)||toman<=0||toman>1000000000||url.protocol!=="https:"||
     url.username||url.password||!url.hostname.includes(".")||spec.length<4)return null;
  return {id:m[1].toLowerCase(),toman,spec,url:url.href,updatedAt:new Date().toISOString()};
}

async function prices() {
  const [btc, usdt, gold] = await Promise.all([
    quote(btcPrice),
    quote(() => tgjuRial(TETHER_URL, "tether")),
    quote(() => tgjuRial(GOLD_URL, "gold"))
  ]);
  return {btc, usdt, gold, at: new Date().toISOString()};
}
function money(item, currency) {
  return item.value === null ? "در دسترس نیست" :
    new Intl.NumberFormat("fa-IR", {maximumFractionDigits: currency === "USD" ? 2 : 0}).format(item.value) + " " + (currency === "USD" ? "دلار" : "تومان");
}
function report(pr) {
  const date = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    timeZone: TIMEZONE, dateStyle: "full", timeStyle: "short"
  }).format(new Date(pr.at));
  return [
    "📊 گزارش قیمت بازار",
    "🗓 " + date,
    "",
    "₿ بیت‌کوین: " + money(pr.btc, "USD"),
    "💵 تتر (USDT): " + money(pr.usdt, "IRR"),
    "🥇 هر گرم طلای ۱۸ عیار: " + money(pr.gold, "IRR"),
    "",
    "نرخ‌ها بر اساس آخرین اطلاعات قابل دریافت‌اند؛ در تعطیلی یا اختلال ممکن است به‌روز نباشند."
  ].join("\n");
}
async function sourcesMessage(env) {
  const rows=await goodQuotes(env);
  const itemSources=rows.filter(r=>r.price).flatMap(r=>[r.item.name+" — "+r.price.spec,r.price.url,""]);
  return [
    "📚 منابع اطلاعات رصدینو",
    "",
    "🌤 هواشناسی ۶ شهر منتخب گلستان",
    "Open-Meteo — داده‌ها و پیش‌بینی مدل هواشناسی برای مرکز هر شهر:",
    "https://open-meteo.com/",
    "",
    "💰 قیمت‌ها",
    "₿ بیت‌کوین (دلار): CoinGecko — منبع اصلی",
    "https://www.coingecko.com/en/coins/bitcoin",
    "در صورت اختلال CoinGecko: Coinbase — منبع جایگزین",
    "https://www.coinbase.com/price/bitcoin",
    "",
    "💵 تتر (تومان): شبکه اطلاع‌رسانی طلا و ارز (TGJU)",
    TETHER_URL,
    "",
    "🥇 طلای ۱۸ عیار (تومان): شبکه اطلاع‌رسانی طلا و ارز (TGJU)",
    GOLD_URL,
    "",
    "🛒 کالاهای مصرفی (قیمت‌های دستیِ دارای تاریخ ثبت)",
    ...(itemSources.length ? itemSources : ["برای این اقلام فعلاً نرخ تازه و منبع قابل اعلام ثبت نشده است.",""]),
    "ℹ️ قیمت‌ها و پیش‌بینی‌ها وابسته به دسترسی و زمان به‌روزرسانی سرویس‌های بالا هستند؛ برای تصمیم‌های حساس، داده‌ها را با منبع اصلی تطبیق بده."
  ].join("\n");
}
async function installWebhook(env) {
  if (!env.BOT_TOKEN || !env.WEBHOOK_SECRET || !env.PUBLIC_URL) return "missing_configuration";
  const webhookUrl = env.PUBLIC_URL.replace(/\/$/, "") + "/telegram";
  const info = await telegram(env, "getWebhookInfo");
  if (info.url === webhookUrl && !info.last_error_message && info.allowed_updates?.includes("callback_query")) return "ready";
  await telegram(env, "setWebhook", {
    url: webhookUrl, secret_token: env.WEBHOOK_SECRET, allowed_updates: ["message","callback_query"],
    drop_pending_updates: false
  });
  return "installed";
}
async function onTelegram(update, env) {
  const m = update?.message;
  if (!m || m.chat?.type !== "private" || typeof m.text !== "string") return;
  const chatId = String(m.chat.id);
  const line = m.text.trim();
  const [rawCmd, maybePin] = line.split(/\s+/, 2);
  const cmd = rawCmd.split("@")[0].toLowerCase();
  const owner = await env.STATE.get("owner_chat_id");

  // Only the verified PIN can initially link the administrative owner.
  // Public membership never needs or changes the owner PIN.
  if (cmd === "/start" && !owner && env.LINK_CODE && maybePin === env.LINK_CODE) {
    await env.STATE.put("owner_chat_id", chatId);
  }
  const user = await registerUser(env, chatId);

  if (cmd === "/start" || cmd === "/menu" || line === "🚀 شروع") {
    await send(env, chatId, welcome() + "\n\n" + (user.notifications_enabled ? "🔔 اعلان قیمت شما فعال است." : "🔕 برای فعال‌سازی اعلان قیمت، /subscribe را بفرست."));
  } else if (cmd === "/price" || cmd === "/now" || line === "💰 قیمت" || line === "📊 قیمت بازار") {
    await sendMarketPrice(env,chatId);
  } else if(cmd === "/goods" || line === "🛒 قیمت کالاهای مصرفی") {
    await sendConsumerPrices(env,chatId);
  } else if(cmd === "/setgood") {
    if(!owner || owner!==chatId) {
      await send(env,chatId,"⛔ ویرایش قیمت کالاها تنها برای مدیر تأییدشده مجاز است.");
    } else {
      const newQuote=goodUpdateFromCommand(line);
      if(!newQuote)await send(env,chatId,"فرمت: /setgood bread 25000 | نان بربری یک عدد | https://example.com/source\nشناسه‌ها: saghe, bread, banana, codex12");
      else {
        await env.STATE.put(goodKey(newQuote.id),JSON.stringify(newQuote));
        await send(env,chatId,"✅ نرخ کالا ثبت شد؛ در فهرست مصرفی و بخش منابع قابل مشاهده است.");
      }
    }
  } else if(cmd === "/cleargood") {
    if(!owner || owner!==chatId) await send(env,chatId,"⛔ ویرایش قیمت کالاها تنها برای مدیر تأییدشده مجاز است.");
    else {
      const id=line.split(/\s+/)[1];
      if(!goodDefinition(id)) await send(env,chatId,"شناسه معتبر نیست: saghe, bread, banana, codex12");
      else {await env.STATE.delete(goodKey(id));await send(env,chatId,"✅ قیمت قبلی حذف شد.");}
    }
  } else if (cmd === "/weather" || line === "🌤 آب و هوا" || line === "🌤 هواشناسی") {
    await sendWeatherMenu(env,chatId);
  } else if (cmd === "/sources" || line === "📚 منابع" || line === "📚 منابع اطلاعات") {
    await send(env,chatId,await sourcesMessage(env));
  } else if (cmd === "/news" || line === "📰 اخبار") {
    await sendGolestanNews(env,chatId,true,0);
  } else if (cmd === "/support" || line === "💬 پشتیبان") {
    await telegram(env, "sendMessage", {
      chat_id: chatId,
      text: "💬 ارتباط با پشتیبان رصدینو\nبرای شروع گفتگوی خصوصی با مدیر، دکمه زیر را بزن یا به @hamidhosseinis پیام بده.",
      disable_web_page_preview: true,
      reply_markup: {inline_keyboard: [[{text: "💬 شروع گفتگو با پشتیبان", url: "https://t.me/hamidhosseinis"}]]}
    });
  } else if (cmd === "/status" || line === "🔔 اعلان‌های من") {
    await send(env, chatId, (user.notifications_enabled ? "🔔 اعلان قیمت فعال است." : "🔕 اعلان قیمت غیرفعال است.") +
      "\n🕙 زمان‌بندی: ۱۰ صبح و ۱۰ شب به وقت ایران.\nفعال‌سازی: /subscribe\nغیرفعال‌سازی: /stop");
  } else if (cmd === "/subscribe") {
    await setUserNotifications(env,chatId,true);
    await send(env,chatId,"✅ اعلان قیمت برای حساب شما فعال شد.\n🕙 هر روز ساعت ۱۰ صبح و ۱۰ شب به وقت ایران.\nبرای توقف: /stop");
  } else if (cmd === "/help" || line === "ℹ️ راهنما") {
    await send(env, chatId, "📖 راهنمای رصدینو\n🚀 شروع: نمایش منو و معرفی\n💰 قیمت: گزارش بازار و کالاهای مصرفی\n🌤 آب و هوا: هوای امروز و فردای ۶ شهر منتخب گلستان\n📚 منابع: مراجع قیمت‌ها و هواشناسی\n📰 اخبار: آخرین تیترهای استان گلستان و لینک منابع\n💬 پشتیبان: گفتگو با @hamidhosseinis\n\nاعلان قیمت اختیاری است و برای هر کاربر جدا تنظیم می‌شود.\nدستورات: /start /price /goods /weather /sources /news /support /subscribe /status /stop");
  } else if (cmd === "/stop") {
    await setUserNotifications(env,chatId,false);
    await send(env,chatId,"⏸ اعلان‌های زمان‌بندی‌شده فقط برای حساب شما متوقف شد.\nبرای دریافت دوباره: /subscribe\nاستفاده از قیمت، هواشناسی و اخبار همچنان فعال است.");
  } else {
    await send(env, chatId, "👇 یکی از پنج دکمه ثابت پایین صفحه را انتخاب کن.");
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/telegram") {
      if (!env.WEBHOOK_SECRET || request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET)
        return new Response("Unauthorized", {status: 401});
      let update;
      try { update = await request.json(); }
      catch (_) { return new Response("Invalid JSON", {status:400}); }
      if (!update || !Number.isInteger(update.update_id)) return new Response("Invalid update", {status:400});
      const key = "update:" + update.update_id;
      if (await env.STATE.get(key)) return new Response("ok");
      try {
        await onUpdate(update, env);
        await env.STATE.put(key, "1", {expirationTtl: 86400});
      } catch(e) {
        console.log("Telegram update failed: " + String(e.message));
        return new Response("Retry", {status:503});
      }
      return new Response("ok");
    }
    if (request.method === "GET" && url.pathname === "/news/status") {
      const data=await env.STATE.get("news:golestan:last_scan");
      return Response.json(data?JSON.parse(data):{status:"not_scanned_yet"},{headers:{"Cache-Control":"no-store"}});
    }
    if (request.method === "GET" && url.pathname === "/prices") {
      const data = await prices();
      return Response.json({report: report(data), quotes:data}, {headers: {"Cache-Control":"no-store"}});
    }
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      let webhook = "not_configured";
      if (env.BOT_TOKEN && env.WEBHOOK_SECRET && env.PUBLIC_URL) {
        try { webhook = await installWebhook(env); }
        catch(e) { webhook = "error: " + String(e.message); }
      }
      return Response.json({
        service:"hamid-price-report-telegram-bot",
        configured: Boolean(env.BOT_TOKEN && env.WEBHOOK_SECRET && env.STATE),
        linked: Boolean(await env.STATE.get("owner_chat_id")),
        access: "public", notifications: "opt-in",
        webhook,
        timezone:TIMEZONE, scheduled_local_times:["10:00","22:00"]
      }, {headers:{"Cache-Control":"no-store"}});
    }
    return new Response("Not found", {status:404});
  },
  async scheduled(event, env, ctx) {
    if(event.cron==="30 4 * * *") {
      ctx.waitUntil(refreshGolestanNews(env));
      return;
    }
    if (event.cron !== "30 6,18 * * *") return;
    ctx.waitUntil((async () => {
      if (!env.BOT_TOKEN) return;
      try { await installWebhook(env); } catch(e) { console.log("Webhook install: " + String(e.message)); }
      const slot = new Date(event.scheduledTime).toISOString().slice(0, 16);
      const owner = await env.STATE.get("owner_chat_id");
      let message = null;
      for await (const chatId of notificationTargets(env)) {
        if (message === null) message = report(await prices());
        await deliverScheduledReport(env, chatId, owner, slot, message);
      }
    })().catch(e => {console.log("Scheduled report failed: " + String(e.message)); throw e;}));
  }
};

// Export narrow testable helpers; HTTP access still requires the verified webhook.
export {registerUser, setUserNotifications, notificationTargets, deliverScheduledReport, GOLESTAN_CITIES, cityWeatherKeyboard};
