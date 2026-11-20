// Private personal finance integration. The public bot never stores records in KV.
const TZ = "Asia/Tehran";
export const EXPENSE_CATEGORIES = Object.freeze([
  "خوراک و خرید روزانه","مسکن و قبوض","حمل‌ونقل و سوخت","سلامت و درمان",
  "پوشاک","تفریح و سفر","خانواده و هدیه","اقساط و بدهی",
  "آموزش","مخابرات و اینترنت","سایر"
]);
const PAYMENT = ["کارت","نقدی","انتقال بانکی","کیف پول","سایر"];
export function digits(text) {
  return String(text??"").replace(/[۰-۹]/g,c=>String("۰۱۲۳۴۵۶۷۸۹".indexOf(c)))
    .replace(/[٠-٩]/g,c=>String("٠١٢٣٤٥٦٧٨٩".indexOf(c)));
}
function fa(text){return String(text).replace(/[0-9]/g,n=>"۰۱۲۳۴۵۶۷۸۹"[Number(n)]);}
export function parseAmount(input) {
  const s=digits(input).trim().replace(/[٬,]/g,"").replace(/٫/g,".");
  const m=s.match(/^([0-9]+(?:\.[0-9]+)?)\s*(میلیون|هزار)?\s*(تومان|تومن|ریال)?$/);
  if(!m)return null;
  const scale=m[2]==="میلیون"?1000000:m[2]==="هزار"?1000:1;
  const rial=m[3]==="ریال"?0.1:1;
  const n=Number(m[1])*scale*rial;
  return Number.isSafeInteger(n) && n>=1 && n<=999999999999 ? n : null;
}
function persianParts(date) {
  const parts=new Intl.DateTimeFormat("en-US-u-ca-persian",{
    timeZone:TZ,year:"numeric",month:"numeric",day:"numeric"
  }).formatToParts(date);
  const x={};for(const p of parts)if(["year","month","day"].includes(p.type))x[p.type]=Number(p.value);
  return x;
}
function pad(x){return String(x).padStart(2,"0");}
export function localStamp(now=new Date()) {
  const x=persianParts(now);
  const jalali=x.year+"/"+pad(x.month)+"/"+pad(x.day);
  const time=new Intl.DateTimeFormat("en-GB",{timeZone:TZ,hour:"2-digit",minute:"2-digit",hour12:false}).format(now);
  return {jalali:fa(jalali),month:fa(x.year+"/"+pad(x.month)),time,iso:now.toISOString(),
    date:new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit"}).format(now)};
}
// Confirm dates against the platform's Persian calendar. Never accept invalid 30/31 days.
export function checkJalaliDate(raw) {
  const s=digits(raw).trim(),m=s.match(/^(14[0-9]{2})[/-]([0-9]{1,2})[/-]([0-9]{1,2})$/);
  if(!m)return null;
  const y=Number(m[1]),mo=Number(m[2]),d=Number(m[3]);
  if(mo<1||mo>12||d<1||d>31)return null;
  const ordinal=mo<=6?(mo-1)*31+d-1:186+(mo-7)*30+d-1;
  const approximate=Date.UTC(y+621,2,20)+ordinal*86400000;
  for(let delta=-4;delta<=4;delta++) {
    const candidate=new Date(approximate+delta*86400000);
    const p=persianParts(candidate);
    if(p.year===y&&p.month===mo&&p.day===d) {
      return {jalali:fa(y+"/"+pad(mo)+"/"+pad(d)),gregorian:candidate.toISOString().slice(0,10)};
    }
  }
  return null;
}
function classify(text) {
  if(/بنزین|گازوئیل|سوخت|تاکسی|اسنپ|ماشین|خودرو|پارکینگ|اتوبوس/.test(text))return "حمل‌ونقل و سوخت";
  if(/ناهار|شام|صبحانه|سوپر|میوه|گوشت|مرغ|نان|خوراک|غذا|رستوران|قهوه/.test(text))return "خوراک و خرید روزانه";
  if(/دارو|پزشک|دکتر|داروخانه|درمان|بیمارستان|آزمایش/.test(text))return "سلامت و درمان";
  if(/اجاره|آبونمان|قبض|برق|گاز|اجاره/.test(text))return "مسکن و قبوض";
  if(/اینترنت|شارژ گوشی|سیم‌کارت|بسته اینترنت/.test(text))return "مخابرات و اینترنت";
  if(/پوشاک|لباس|کفش/.test(text))return "پوشاک";
  if(/قسط|بدهی/.test(text))return "اقساط و بدهی";
  return "سایر";
}
export function parseFinanceEntry(text,now=new Date()) {
  const s=String(text??"").trim().slice(0,700);
  const stamp=localStamp(now);
  const parts=s.split("|").map(x=>x.trim());
  if(parts.length>1) {
    const type=parts[0];
    if(type==="هزینه") {
      const value=parseAmount(parts[1]);if(!value||!parts[3])return null;
      const category=EXPENSE_CATEGORIES.includes(parts[2])?parts[2]:classify(parts[2]+" "+parts[3]);
      const method=PAYMENT.includes(parts[4])?parts[4]:"سایر";
      return {action:"append_expense",data:{amount:value,category,description:parts[3].slice(0,170),
        payment:method,...stamp}};
    }
    if(type==="وام" && parts.length>=5) {
      const principal=parseAmount(parts[2]),installment=parseAmount(parts[3]),due=checkJalaliDate(parts[4]);
      if(!parts[1]||!principal||!installment||!due)return null;
      return {action:"append_debt",data:{kind:"وام",name:parts[1].slice(0,90),title:(parts[5]||"وام").slice(0,100),
        principal,balance:principal,installment,due,...stamp}};
    }
    if(type==="بدهی" && parts.length>=4) {
      const principal=parseAmount(parts[2]),due=checkJalaliDate(parts[3]);
      if(!parts[1]||!principal||!due)return null;
      return {action:"append_debt",data:{kind:"بدهی",name:parts[1].slice(0,90),title:(parts[4]||"بدهی").slice(0,100),
        principal,balance:principal,installment:0,due,...stamp}};
    }
    if(type==="چک" && parts.length>=5) {
      const kind=parts[1],due=checkJalaliDate(parts[2]),amount=parseAmount(parts[3]);
      if(!["صادره","دریافتی"].includes(kind)||!due||!amount||!parts[4])return null;
      return {action:"append_check",data:{kind,due,amount,counterparty:parts[4].slice(0,90),
        number:(parts[5]||"").slice(0,50),description:(parts[6]||"").slice(0,170),...stamp}};
    }
    return null;
  }
  const m=s.match(/^هزینه\s+([۰-۹٠-٩0-9٬,٫.]+)(?:\s*(میلیون|هزار))?(?:\s*(تومان|تومن|ریال))?\s+(.+)$/);
  if(m) {
    const amount=parseAmount(m[1]+" "+(m[2]||"")+" "+(m[3]||""));
    if(!amount)return null;
    const description=m[4].trim();
    return {action:"append_expense",data:{amount,category:classify(description),
      description:description.slice(0,170),payment:"سایر",...stamp}};
  }
  return null;
}
export function isFinanceMessage(text){
  return /^(?:هزینه(?:\s|\|)|وام\s*\||بدهی\s*\||چک\s*\|)/.test(String(text??"").trim());
}
export function financeKeyboard(){return {inline_keyboard:[
  [{text:"💸 هزینه",callback_data:"finance:expense"},{text:"🏦 بدهی و وام",callback_data:"finance:debt"}],
  [{text:"🧾 ثبت چک",callback_data:"finance:check"},{text:"📊 گزارش ماه",callback_data:"finance:report"}],
  [{text:"📋 بدهی‌های فعال",callback_data:"finance:debtlist"},{text:"📋 چک‌های باز",callback_data:"finance:checklist"}],
  [{text:"🏠 منوی اصلی",callback_data:"main:menu"},{text:"❌ بستن",callback_data:"menu:close"}]
]};}
export function financePrompt(kind) {
  const examples={
    expense:"💸 ثبت هزینه\nنمونه ساده:\nهزینه ۲۵۰ هزار تومان بنزین\n\nنمونه دقیق:\nهزینه | ۲۵۰۰۰۰ | حمل‌ونقل و سوخت | بنزین ماشین | کارت",
    debt:"🏦 ثبت وام:\nوام | بانک ملت | ۵۰ میلیون | ۳ میلیون | ۱۴۰۵/۰۹/۱۵ | خرید خودرو\n\nثبت بدهی:\nبدهی | علی | ۵ میلیون | ۱۴۰۵/۰۹/۱۵ | قرض",
    check:"🧾 ثبت چک:\nچک | صادره | ۱۴۰۵/۰۹/۱۵ | ۱۰ میلیون | نام گیرنده | شماره چک\n\nبرای چک دریافتی، «صادره» را با «دریافتی» عوض کن."
  };
  return examples[kind]||"💼 حسابداری شخصی | هزینه، وام، بدهی و چک";
}
export function configured(env) {
  return typeof env.FINANCE_API_URL==="string" &&
    /^https:\/\/script\.google\.com\/macros\/s\/[-\w]+\/exec$/.test(env.FINANCE_API_URL) &&
    typeof env.FINANCE_API_TOKEN==="string" && env.FINANCE_API_TOKEN.length>=32;
}
export async function financeRequest(env,action,data={},id=null) {
  if(!configured(env))throw new Error("Finance not configured");
  const response=await fetch(env.FINANCE_API_URL,{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({token:env.FINANCE_API_TOKEN,action,data,id}),
    signal:AbortSignal.timeout(12000)
  });
  if(!response.ok)throw new Error("Finance HTTP error");
  const result=await response.json();
  if(!result||result.ok!==true)throw new Error("Finance API failed");
  return result;
}
