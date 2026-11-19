import test from "node:test";
import assert from "node:assert/strict";
import {canonicalYouTubeVideoUrl,downloaderConfigured,submitYouTubeJob} from "../src/download/youtube.mjs";

test("accepts only single YouTube videos, normalizes recognized URLs",()=>{
  const expected="https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  for(const value of [
    expected,
    "https://youtu.be/dQw4w9WgXcQ?t=10",
    "https://m.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/live/dQw4w9WgXcQ",
    "https://music.youtube.com/watch?v=dQw4w9WgXcQ"
  ]) assert.equal(canonicalYouTubeVideoUrl(value),expected);
  for(const value of [
    "https://evil.test/watch?v=dQw4w9WgXcQ",
    "http://youtu.be/dQw4w9WgXcQ",
    "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
    "https://youtube.com/playlist?list=XYZ",
    "https://youtu.be/dQw4w9WgXcQ/other",
    "javascript:alert(1)",
    "https://www.youtube.com/watch?v=short",
    "https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ",
    " https://youtu.be/dQw4w9WgXcQ"
  ]) assert.equal(canonicalYouTubeVideoUrl(value),null,value);
});

test("requires configured HTTPS backend and private API key",()=>{
  assert.equal(downloaderConfigured({}),false);
  assert.equal(downloaderConfigured({YOUTUBE_DOWNLOAD_SERVICE_URL:"http://localhost/jobs",YOUTUBE_DOWNLOAD_API_KEY:"secret"}),false);
  assert.equal(downloaderConfigured({YOUTUBE_DOWNLOAD_SERVICE_URL:"https://example.org/jobs",YOUTUBE_DOWNLOAD_API_KEY:"secret"}),true);
});

test("submission validates URL and reports accepted job without exposing secret",async()=>{
  const env={YOUTUBE_DOWNLOAD_SERVICE_URL:"https://example.org/jobs",YOUTUBE_DOWNLOAD_API_KEY:"test-private-key"};
  const old=globalThis.fetch;
  let called=0;
  globalThis.fetch=async(url,options)=>{
    called++;
    assert.equal(url,env.YOUTUBE_DOWNLOAD_SERVICE_URL);
    assert.equal(options.headers["X-Download-Key"],env.YOUTUBE_DOWNLOAD_API_KEY);
    assert.deepEqual(JSON.parse(options.body),{
      chat_id:"123456",youtube_url:"https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    });
    return {status:202};
  };
  try{
    assert.deepEqual(await submitYouTubeJob(env,"123456","https://youtu.be/dQw4w9WgXcQ"),{ok:true,reason:"accepted"});
    assert.deepEqual(await submitYouTubeJob(env,"123456","https://example.com/watch?v=abc"),{ok:false,reason:"invalid"});
    assert.equal(called,1);
  }finally{globalThis.fetch=old;}
});

test("an unavailable download service never reports completion",async()=>{
  const old=globalThis.fetch;
  try {
    globalThis.fetch=async()=>({status:503});
    const env={YOUTUBE_DOWNLOAD_SERVICE_URL:"https://example.org/jobs",YOUTUBE_DOWNLOAD_API_KEY:"secret"};
    assert.deepEqual(await submitYouTubeJob(env,"1","https://youtu.be/dQw4w9WgXcQ"),{ok:false,reason:"backend_unavailable"});
  } finally {globalThis.fetch=old;}
});
