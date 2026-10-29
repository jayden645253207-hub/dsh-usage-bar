// 计价、峰谷时段、金额与余额格式。
import assert from "node:assert/strict";
import test from "node:test";
import { loadPlugin } from "./harness.mjs";

const { module } = loadPlugin();
const { priceFor, isPeak, formatMoney, formatBalance, summarizeBalance } = module.__internals;

test("价目表按官方人民币高峰价", () => {
  assert.deepEqual(priceFor("deepseek-flash"), { cacheHit: 0.04, cacheMiss: 2, output: 8 });
  assert.deepEqual(priceFor("deepseek-v4-pro"), { cacheHit: 0.3, cacheMiss: 9, output: 27 });
});

test("未知模型与旧模型名回退到 flash", () => {
  const flash = { cacheHit: 0.04, cacheMiss: 2, output: 8 };
  assert.deepEqual(priceFor("gpt-5"), flash);
  assert.deepEqual(priceFor("deepseek-v4-flash-vision-exp"), flash);
  assert.deepEqual(priceFor(undefined), flash);
});

test("北京时间高峰时段：工作日 9-12、14-18，右开区间", () => {
  assert.equal(isPeak(Date.parse("2026-10-26T01:00:00Z")), true, "周一 09:00 高峰");
  assert.equal(isPeak(Date.parse("2026-10-26T03:59:00Z")), true, "周一 11:59 高峰");
  assert.equal(isPeak(Date.parse("2026-10-26T04:00:00Z")), false, "周一 12:00 已过高峰");
  assert.equal(isPeak(Date.parse("2026-10-26T05:59:00Z")), false, "周一 13:59 午休");
  assert.equal(isPeak(Date.parse("2026-10-26T06:00:00Z")), true, "周一 14:00 高峰");
  assert.equal(isPeak(Date.parse("2026-10-26T10:00:00Z")), false, "周一 18:00 已过高峰");
});

test("周末全天空闲", () => {
  assert.equal(isPeak(Date.parse("2026-10-31T02:00:00Z")), false, "周六 10:00");
  assert.equal(isPeak(Date.parse("2026-11-01T07:00:00Z")), false, "周日 15:00");
});

test("金额格式", () => {
  assert.equal(formatMoney(0), "¥0.00");
  assert.equal(formatMoney(0.004321), "¥0.0043");
  assert.equal(formatMoney(0.4321), "¥0.43");
  assert.equal(formatMoney(1234.5), "¥1234.50");
});

test("余额格式与分位", () => {
  assert.equal(formatBalance(1234.5), "¥1,234.50");
  assert.equal(formatBalance(0.004), "<¥0.01");
  assert.equal(formatBalance(Number.NaN), "—");
});

test("余额结构折叠为充值 + 赠金", () => {
  assert.deepEqual(
    summarizeBalance({
      status: "ready",
      value: [{ currency: "CNY", balance: "10.50" }],
      bonusWallets: [{ currency: "CNY", balance: "2.25" }],
    }),
    { currency: "CNY", total: 12.75, toppedUp: 10.5, granted: 2.25 },
  );
});

test("没有 CNY 时退回 USD", () => {
  assert.deepEqual(
    summarizeBalance({ status: "ready", value: [{ currency: "USD", balance: "3.00" }], bonusWallets: [] }),
    { currency: "USD", total: 3, toppedUp: 3, granted: 0 },
  );
});

test("失败态与缺失值返回 undefined", () => {
  assert.equal(summarizeBalance({ status: "failed" }), undefined);
  assert.equal(summarizeBalance(undefined), undefined);
});
