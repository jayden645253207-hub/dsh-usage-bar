// 最小化的 DSH 客户端替身：加载 bundle，提供一个足够跑 apply() 的 ctx。
// 只模拟本插件用到的契约（slots.register 校验、ctx.inject、sessions.binding），
// 不是 DSH 运行时的完整复刻。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function loadPlugin() {
  let captured;
  globalThis.window = { __ModuleLoader__: { load: (registration) => { captured = registration; } } };
  if (globalThis.navigator === undefined) {
    Object.defineProperty(globalThis, "navigator", { value: { language: "zh-CN" }, configurable: true });
  }
  new Function(readFileSync(join(root, "lib/client.js"), "utf8"))();

  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
    useEffect: () => {},
    useMemo: (factory) => factory(),
    useCallback: (callback) => callback,
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  };
  const module = captured.factory((specifier) => {
    if (specifier === "react") return React;
    throw new Error("unexpected require: " + specifier);
  });
  return { id: captured.id, module };
}

/** list 槽位必须带 id，单值槽位不许带——与 DSH 的注册校验一致。 */
const LIST_SLOTS = new Set(["shell.overlay", "conversation.composer.dock", "conversation.input.left", "conversation.input.right"]);

export function createContext({ account } = {}) {
  const registrations = [];
  const slotInjects = [];
  const serviceInjects = [];
  const ctx = {
    sessions: { binding: () => undefined },
    remote: account === undefined ? {} : { account },
    inject(dependencies, body) {
      serviceInjects.push(dependencies);
      body({ remote: ctx.remote });
    },
    slots: {
      inject(slot, body) {
        slotInjects.push(slot);
        body();
      },
      register(options, component) {
        if (options.name === undefined) throw new Error("slot registration requires a name");
        if (LIST_SLOTS.has(options.name) && options.id === undefined) {
          throw new Error(`list slot "${options.name}" requires options.id`);
        }
        registrations.push({ options, component });
        return () => {};
      },
    },
  };
  return { ctx, registrations, slotInjects, serviceInjects };
}
