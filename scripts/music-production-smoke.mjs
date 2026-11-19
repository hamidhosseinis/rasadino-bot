// Live, read-only Rasadino Worker smoke via GitHub Actions.
// Does NOT send Telegram messages or include any private secrets.
// POST /telegram is deliberately unauthorized to verify webhook protection.
import assert from "node:assert/strict";
const ROOT = "https://hamid-price-report-bot.mahale-market-kordkuy.workers.dev";
async function request(path,{method="GET",headers={},body}={}){
  const response=await fetch(ROOT+path,{
    method,headers,body,redirect:"error",signal:AbortSignal.timeout(18000)
  });
  return response;
}
const status=await request("/news/status");
assert.equal(status.status,200,"Existing news status endpoint must be healthy");
assert.match(status.headers.get("content-type")||"",/application\/json/);
const news=await status.json();
assert.equal(typeof news,"object");
console.log("PASS /news/status: 200, valid JSON");

const health=await request("/health");
assert.equal(health.status,200,"Production health must respond");
const h=await health.json();
assert.equal(h.service,"hamid-price-report-telegram-bot");
assert.equal(h.configured,true);
assert.equal(h.timezone,"Asia/Tehran");
assert.ok(typeof h.webhook==="string"&&!h.webhook.startsWith("error:"),"Production Telegram webhook setup is healthy");
console.log("PASS /health: configured, timezone, Telegram webhook checked");

const p=await request("/prices");
assert.equal(p.status,200,"Existing prices route must work");
const prices=await p.json();
assert.equal(typeof prices.report,"string");
assert.ok(prices.quotes && typeof prices.quotes==="object");
assert.match(prices.report,/^📡 رصدینو \| نبض بازار/,"Live report should use market pulse layout");
assert.match(prices.report,/بیت‌کوین \| BTC/);
assert.match(prices.report,/نفت خام برنت \| BRENT/);
assert.match(prices.report,/تتر \| USDT/);
assert.match(prices.report,/طلای ۱۸ عیار \| GOLD/);
assert.match(prices.report,/مبدأ مقایسه:/);
assert.match(prices.report,/رشد تاریخی:/);
assert.ok(prices.report.split("\n").length>=21,"Must show separated asset cards and provenance");
assert.ok(prices.report.length<1200,"Market card must remain concise");
assert.doesNotMatch(prices.report,/<b>|<\/b>/,"Public JSON report should remain plain text");
assert.doesNotMatch(prices.report,/CoinGecko|Coinbase|tgju\.org/,"Sources belong behind the sources button");
console.log("PASS /prices: 4 market pulse cards, 2 historical baselines, plain JSON and valid quotes");

const unauthorized=await request("/telegram",{
  method:"POST",
  headers:{"Content-Type":"application/json","X-Telegram-Bot-Api-Secret-Token":"INVALID_STAGE5_SMOKE"},
  body:JSON.stringify({update_id:2147483000,message:{chat:{id:999,type:"private"},text:"/music"}})
});
assert.equal(unauthorized.status,401,"Forged webhook must not be accepted");
console.log("PASS /telegram: unauthorized fake update denied (no Telegram message sent)");

const unknown=await request("/music");
assert.equal(unknown.status,404,"Music commands must remain Telegram-only");
console.log("PASS /music HTTP: not exposed publicly");

console.log("LIVE RASADINO SMOKE (market pulse v29): 5/5 passed.");
