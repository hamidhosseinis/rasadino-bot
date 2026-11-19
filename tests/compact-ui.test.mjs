import test from "node:test";
import assert from "node:assert/strict";
import {welcome, report, sourcesMessage, makeNewsMessage} from "../src/worker.mjs";
import {musicMenuView} from "../src/music/menus.mjs";
import {renderRecommendations} from "../src/music/recommendations.mjs";
import {renderMusicSearch} from "../src/music/search.mjs";

test("core screens stay compact without hiding key facts",()=>{
  const hi=welcome();
  assert.ok(hi.length<180);
  assert.match(hi,/قیمت/);
  assert.match(hi,/موزیک/);

  const now=new Date().toISOString();
  const quote=(value)=>({value,updatedAt:now});
  const snapshot={at:now,btc:quote(95000),usdt:quote(110000),gold:quote(10000000),
    oil:{...quote(95),marketDate:now.slice(0,10),oilType:"futures"}};
  const market=report(snapshot);
  assert.ok(market.length<800,"The price card should fit without scrolling through prose");
  assert.equal(market.split("\n").length,6);
  assert.match(market,/۱۳۵۷/);
  assert.match(market,/رشدها اسمی/);

  const sources=sourcesMessage();
  assert.ok(sources.length<2100);
  assert.match(sources,/Open-Meteo/);
  assert.match(sources,/FRED/);
  assert.match(sources,/تتر در ۱۳۵۷ وجود نداشت/);
});

test("news list remains headline-only, detail actions stay paired",()=>{
  const items=Array.from({length:10},(_,i)=>({
    title:"خبر مهم "+(i+1),source:"رسانه آزمون",
    url:"https://example.org/"+(i+1),county:"گرگان"
  }));
  const first=makeNewsMessage({items,stale:false},0,"abcd1234");
  assert.ok(first.text.length<800);
  assert.equal(first.text.split("\n").length,6);
  assert.doesNotMatch(first.text,/رسانه آزمون|example.org/);
  assert.equal(first.inline_keyboard.flat().filter(x=>x.callback_data?.startsWith("news:detail:")).length,5);
  assert.ok(first.inline_keyboard.some(row=>row.some(b=>b.callback_data==="news:view:abcd1234:1")));
});

test("music screens are concise while official track links remain",()=>{
  assert.ok(musicMenuView().text.length<150);
  assert.ok(musicMenuView("music:search:fa").text.length<280);
  const track={title:"A Short Song",artist:"Artist",source:"iTunes",play_url:"https://music.apple.com/example",
    release_date:"2026-10-10",genre:"Pop",year:2026};
  const search=renderMusicSearch({status:"ok",tracks:[track],fromCache:false,failedProviders:[]}, "us");
  assert.ok(search.text.length<330);
  assert.equal(search.keyboard.inline_keyboard[0][0].url,track.play_url);
  const rec=renderRecommendations({status:"ok",language:"us",genre:"pop",mode:"new",
    sourceNote:"جست‌وجوی کاتالوگ iTunes آمریکا و Audius",tracks:[track],fromCache:false,failedProviders:[]});
  assert.ok(rec.text.length<450);
  assert.equal(rec.keyboard.inline_keyboard[0][0].url,track.play_url);
  assert.match(rec.text,/۱۸ ماه گذشته/);
});
