import test from "node:test";
import assert from "node:assert/strict";
import {historicalGrowthPercent, priceLine} from "../src/worker.mjs";

test("relative percentage is (current / baseline - 1) * 100",()=>{
  assert.equal(historicalGrowthPercent({value:14},7),100);
  assert.equal(historicalGrowthPercent({value:3.5},7),-50);
  assert.equal(historicalGrowthPercent({value:null},7),null);
  assert.equal(historicalGrowthPercent({value:10},0),null);
});
test("BTC uses earliest quoted USD benchmark rather than toman",()=>{
  const message=priceLine({value:100000},"btc");
  assert.match(message,/بیت‌کوین/);
  assert.match(message,/۲۰۰۹/);
  assert.match(message,/↗/);
  assert.ok(Math.abs(historicalGrowthPercent({value:100000},1/1309.03)-13090299900)<1);
});
test("oil comparison uses World Bank March 1978 proxy (12.66 USD/bbl)",()=>{
  assert.equal(historicalGrowthPercent({value:25.32},12.66),100);
  const line=priceLine({value:25.32,marketDate:"2026-11-17"},"oil");
  assert.match(line,/نفت خام برنت/);
  assert.match(line,/۱۲٫۶۶ دلار/);
  assert.match(line,/۱۳۵۷/);
  assert.match(line,/آخرین روز معامله/);
  assert.match(line,/↗/);
  assert.equal(priceLine({value:100},"usd"),"قیمت نامشخص");
});
test("gold historical estimates unchanged",()=>{
  assert.match(priceLine({value:6000000},"gold"),/برآورد حدود ۳۰ تومان/);
});
test("tether is compared with 1978 dollar, not fictitious 1978 tether",()=>{
  assert.match(priceLine({value:100000},"usdt"),/تتر آن زمان وجود نداشت/);
  assert.match(priceLine({value:null},"usdt"),/در دسترس نیست/);
});
