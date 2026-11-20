/**
 * Rasadino private finance bridge (Google Apps Script, V8 runtime).
 *
 * Bind this script to no particular workbook. Deploy as a Web App:
 * - Execute as: Me
 * - Who has access: Anyone (shared secret checked in doPost)
 *
 * Set script properties:
 * FINANCE_SHEET_ID = ID of your private Google Sheet (never place in public source).
 * FINANCE_API_TOKEN = random, high-entropy secret (32+ characters).
 *
 * Bind Cloudflare Worker secrets FINANCE_API_URL (the /exec URL) and
 * FINANCE_API_TOKEN (exact same secret). Never commit either value.
 */
const TAB = Object.freeze({
  append_expense:"هزینه‌ها",
  append_debt:"وام‌ها و بدهی‌ها",
  append_check:"چک‌ها"
});
function asText(v,max=180){
  if(typeof v!=="string")return "";
  // Prefix untrusted formula-looking strings to prevent formula injection.
  let s=v.trim().slice(0,max).replace(/[\u0000-\u001f]/g," ");
  if(/^[=+\-@]/.test(s))s="'"+s;
  return s;
}
function positiveMoney(v){return Number.isSafeInteger(v)&&v>=1&&v<1e12;}
function moneyOrZero(v){return Number.isSafeInteger(v)&&v>=0&&v<1e12;}
function sheetFor(name,id) {
  const book=SpreadsheetApp.openById(id);
  const tab=book.getSheetByName(name);
  if(!tab)throw Error("Missing finance tab");
  return tab;
}
function duplicate(tab,id) {
  const count=tab.getLastRow();
  return count>1 && tab.getRange(2,1,count-1,1).getValues().some(row=>row[0]===id);
}
function validateDate(d){
  return d&&typeof d==="object"&&
    /^\d{4}-\d{2}-\d{2}$/.test(d.gregorian||"")&&
    /^[۰-۹]{4}\/[۰-۹]{2}\/[۰-۹]{2}$/.test(d.jalali||"");
}
function record(action,d,id){
  if(typeof id!=="string"||!/^tg:[0-9]{1,20}$/.test(id))throw Error("Invalid record ID");
  if(!d||typeof d!=="object"||typeof d.iso!=="string"||
    !Number.isFinite(Date.parse(d.iso)))throw Error("Invalid timestamp");
  const now=asText(d.iso,36);
  if(action==="append_expense") {
    if(!positiveMoney(d.amount)||!asText(d.description)||!asText(d.category)||!asText(d.month))throw Error("Invalid expense");
    return [id,asText(d.date,20),asText(d.jalali,20),asText(d.time,10),
      d.amount,asText(d.category,40),asText(d.description),asText(d.payment,30),
      asText(d.month,20),now];
  }
  if(action==="append_debt"){
    if(!["وام","بدهی"].includes(d.kind)||!positiveMoney(d.principal)||
      !moneyOrZero(d.balance)||!moneyOrZero(d.installment)||!validateDate(d.due)||
      !asText(d.name))throw Error("Invalid debt");
    return [id,d.kind,asText(d.title),asText(d.name),d.principal,d.balance,d.installment,
      d.due.gregorian,d.due.jalali,"فعال","",now];
  }
  if(action==="append_check") {
    if(!["صادره","دریافتی"].includes(d.kind)||!positiveMoney(d.amount)||
      !validateDate(d.due)||!asText(d.counterparty))throw Error("Invalid check");
    return [id,d.kind,asText(d.counterparty),asText(d.number,70),d.amount,
      d.due.gregorian,d.due.jalali,"در انتظار",asText(d.description),now];
  }
  throw Error("Invalid action");
}
function moneyToTotal(rows,month) {
  const totals={};let total=0,count=0;
  for(const row of rows){
    if(String(row[8])!==month)continue; // "هزینه‌ها" sheet: month at column I
    const n=Number(row[4]);
    if(!Number.isFinite(n)||n<=0)continue;
    total+=n;count++;
    const cat=String(row[5]||"سایر");
    totals[cat]=(totals[cat]||0)+n;
  }
  return {month,total,count,categories:totals};
}
function getMonth(){
  const x=new Intl.DateTimeFormat("en-US-u-ca-persian",
    {year:"numeric",month:"2-digit",timeZone:"Asia/Tehran"}).formatToParts(new Date());
  let y="",m="";
  for(const p of x){if(p.type==="year")y=p.value;if(p.type==="month")m=p.value;}
  return (y+"/"+m.padStart(2,"0")).replace(/[0-9]/g,x=>"۰۱۲۳۴۵۶۷۸۹"[Number(x)]);
}
function monthlyReport(sheetId,m){
  const month=asText(m||getMonth(),20);
  if(!/^[۰-۹]{4}\/[۰-۹]{2}$/.test(month))throw Error("Invalid month");
  const tab=sheetFor("هزینه‌ها",sheetId),last=tab.getLastRow();
  const data=last>1?tab.getRange(2,1,last-1,10).getValues():[];
  return moneyToTotal(data,month);
}
function listOutstanding(sheetId,kind){
  const isDebt=kind==="list_debts",name=isDebt?"وام‌ها و بدهی‌ها":"چک‌ها";
  const tab=sheetFor(name,sheetId),last=tab.getLastRow();
  const data=last>1?tab.getRange(Math.max(2,last-198),1,Math.min(199,last-1),isDebt?12:10).getValues():[];
  const statusIndex=isDebt?9:7,items=[];
  for(let i=data.length-1;i>=0&&items.length<8;i--){
    const row=data[i];
    if((isDebt&&row[statusIndex]!=="فعال")||(!isDebt&&row[statusIndex]!=="در انتظار"))continue;
    items.push(isDebt?{kind:row[1],name:row[3],balance:row[5],due:row[8],installment:row[6]}:
      {kind:row[1],name:row[2],amount:row[4],due:row[6]});
  }
  return {items};
}
function json(obj){return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);}
function doPost(e) {
  // Google Apps Script's ContentService can return JSON but does not let this
  // endpoint control the HTTP status code. The Worker checks response.ok.
  try {
    const jsonText=e&&e.postData&&e.postData.contents;
    if(!jsonText||jsonText.length>10000)throw Error("Invalid request");
    const input=JSON.parse(jsonText);
    const properties=PropertiesService.getScriptProperties();
    const expected=properties.getProperty("FINANCE_API_TOKEN");
    const sheetId=properties.getProperty("FINANCE_SHEET_ID");
    if(!expected||expected.length<32||!sheetId||input.token!==expected)throw Error("Not authorized");
    const action=String(input.action||"");
    if(action==="summary_month")return json({ok:true,...monthlyReport(sheetId,input.data&&input.data.month)});
    if(action==="list_debts"||action==="list_checks")return json({ok:true,...listOutstanding(sheetId,action)});
    if(!Object.prototype.hasOwnProperty.call(TAB,action))throw Error("Unsupported operation");
    const row=record(action,input.data,input.id);
    const lock=LockService.getScriptLock();
    if(!lock.tryLock(15000))throw Error("Busy");
    try{
      const tab=sheetFor(TAB[action],sheetId);
      if(!duplicate(tab,input.id)){
        tab.getRange(tab.getLastRow()+1,1,1,row.length).setValues([row]);
      }
      SpreadsheetApp.flush();
    } finally{lock.releaseLock();}
    return json({ok:true,saved:true,id:input.id});
  } catch(err) {
    // Never echo secret, inputs or financial data to callers.
    return json({ok:false,error:"Operation rejected"});
  }
}
