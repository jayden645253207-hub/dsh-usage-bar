// 注册契约：apply() 产出的槽位注册必须满足 DSH 的校验，
// 且组件在 props 缺失时不能抛错。
import assert from "node:assert/strict";
import test from "node:test";
import { loadPlugin, createContext } from "./harness.mjs";

test("只注册 composer.dock，且带 id 与 order", () => {
  const { module } = loadPlugin();
  const { ctx, registrations } = createContext();
  module.apply(ctx);
  assert.equal(registrations.length, 1);
  const [entry] = registrations;
  assert.equal(entry.options.name, "conversation.composer.dock");
  assert.equal(entry.options.id, "usage-chips");
  assert.equal(typeof entry.options.order, "number");
});

test("服务注入：slots/sessions 静态声明，remote.account 单独 inject", () => {
  const { module } = loadPlugin();
  const { ctx, serviceInjects } = createContext();
  module.apply(ctx);
  assert.deepEqual(module.inject, ["slots", "sessions"]);
  assert.deepEqual(serviceInjects, [["remote.account"]]);
});

test("inject 回调把 sessions 与 account 交给组件", () => {
  const { module } = loadPlugin();
  const account = { getBalance: () => Promise.resolve({ ok: false }) };
  const { ctx, registrations } = createContext({ account });
  module.apply(ctx);
  const props = registrations[0].options.inject();
  assert.equal(props.sessions, ctx.sessions);
  assert.equal(props.account, account);
});

test("组件在 props 缺失或为空时不抛错", () => {
  const { module } = loadPlugin();
  assert.doesNotThrow(() => module.UsageChips({}));
  assert.doesNotThrow(() => module.UsageChips({ sessions: undefined, account: undefined }));
});
