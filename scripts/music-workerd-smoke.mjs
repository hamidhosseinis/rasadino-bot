// Run with: npm i --no-save --no-package-lock miniflare@latest && node scripts/music-workerd-smoke.mjs
// Purely local: no Cloudflare account, live Telegram token, or production namespace.
import assert from "node:assert/strict";
import {Miniflare} from "miniflare";

const options={
  modules:true,
  modulesRules:[{type:"ESModule",include:["**/*.mjs"]}],
  compatibilityDate:"2026-11-05",
  cf:false,port:0,kvNamespaces:["STATE"]
};

const music=new Miniflare({...options,scriptPath:"scripts/music-workerd-fixture.mjs"});
try {
  const health=await music.dispatchFetch("http://localhost:8787/health");
  assert.equal(health.status,200);
  assert.equal((await health.json()).realNetwork,false);
  const first=await (await music.dispatchFetch("http://localhost:8787/search?query=Test%20Artist")).json();
  assert.equal(first.status,"ok");
  assert.equal(first.count,1);
  assert.equal(first.fromCache,false);
  assert.ok(first.links.every(link=>new URL(link).hostname==="music.apple.com"));
  const second=await (await music.dispatchFetch("http://localhost:8787/search?query=Test%20Artist")).json();
  assert.equal(second.status,"ok");
  assert.equal(second.count,1);
  assert.equal(second.fromCache,true);
  const kv=await music.getKVNamespace("STATE");
  const keys=await kv.list({prefix:"music:search:v1:"});
  assert.equal(keys.keys.length,1);
  assert.ok(keys.keys[0].expiration>Date.now()/1000);
  console.log("PASS: local workerd executes iTunes normalization, SHA-256 cache and KV TTL.");
} finally {
  await music.dispose();
}

const worker=new Miniflare({...options,scriptPath:"src/worker.mjs",bindings:{WEBHOOK_SECRET:"STAGE5_FAKE_SECRET"}});
try{
  const denied=await worker.dispatchFetch("http://localhost:8787/telegram",{
    method:"POST",
    headers:{"Content-Type":"application/json","X-Telegram-Bot-Api-Secret-Token":"INVALID"},
    body:JSON.stringify({update_id:1})
  });
  assert.equal(denied.status,401);
  const res=await worker.dispatchFetch("http://localhost:8787/health");
  assert.equal(res.status,200);
  const json=await res.json();
  assert.equal(json.configured,false);
  assert.equal(json.webhook,"not_configured");
  console.log("PASS: actual Rasadino Worker safely rejects unsigned webhooks and checks health without tokens.");
}finally{
  await worker.dispose();
}
