window.__ModuleLoader__.load({
	id: "dsh-usage-bar",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		const React = require("react");
		const h = React.createElement;

		// ---------------------------------------------------------------------
		// 价目表 — DeepSeek 官方定价（人民币 / 百万 tokens，高峰时段价）。
		// 来源：https://api-docs.deepseek.com/zh-cn/quick_start/pricing
		// 取数日期：2026-10-26
		//
		//   模型             缓存命中   缓存未命中   输出
		//   deepseek-flash   0.04 元    2 元        8 元
		//   deepseek-v4-pro  0.30 元    9.0 元      27.0 元
		//
		// 空闲时段价格是高峰的一半。高峰时段为北京时间周一至周五
		// （不含中国法定节假日）9:00-12:00、14:00-18:00。
		// ---------------------------------------------------------------------
		const PRICES = {
			"deepseek-flash": { cacheHit: 0.04, cacheMiss: 2, output: 8 },
			"deepseek-v4-flash": { cacheHit: 0.04, cacheMiss: 2, output: 8 },
			"deepseek-v4-pro": { cacheHit: 0.3, cacheMiss: 9, output: 27 }
		};
		const FALLBACK_MODEL = "deepseek-flash";
		const OFF_PEAK_RATIO = 0.5;
		const PEAK_WINDOWS_CST = [
			[9, 12],
			[14, 18]
		];
		const CST_OFFSET_MS = 8 * 60 * 60 * 1000;

		// 账号接口要求的客户端元数据；version 只进 x-client-version 请求头。
		const CLIENT_VERSION = "0.2.1-rc.3";
		const BALANCE_REFRESH_MS = 60000;
		const DIAGNOSTIC_KEY = "dsh-usage-bar/diagnostics";

		function report(stage, error) {
			try {
				console.warn("[dsh-usage-bar] " + stage + ":", error);
			} catch (ignored) {
				// 控制台不可用时不影响渲染
			}
		}

		const CSS = [
			".dsh-usage-chips{display:inline-flex;align-items:center;gap:6px;font-size:13px;",
			"line-height:20px;font-variant-numeric:tabular-nums;white-space:nowrap;user-select:none;",
			"color:var(--dsw-alias-label-tertiary,#8a8a8a)}",
			".dsh-usage-chips__sep{color:var(--dsw-alias-label-dimmed,#c0c0c0)}",
			".dsh-usage-chips__value{color:var(--dsw-alias-label-primary,#1f1f1f);font-weight:500}",
			".dsh-usage-chips__error{color:var(--dsw-alias-state-error-primary,#d33)}",
			".dsh-usage-toast{position:fixed;left:16px;bottom:16px;z-index:2147483000;pointer-events:none;",
			"padding:8px 12px;border-radius:8px;font-size:12px;line-height:18px;white-space:pre-wrap;max-width:420px;",
			"background:rgba(20,20,20,.88);color:#fff;box-shadow:0 6px 20px rgba(0,0,0,.25)}"
		].join("");

		const STYLE_KEY = "dsh-usage-bar/chips.css";
		if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="' + STYLE_KEY + '"]') === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-usage-bar";
			tag.dataset.pluginCss = STYLE_KEY;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		function priceFor(model) {
			if (typeof model === "string" && model.length > 0) {
				if (PRICES[model] !== undefined) return PRICES[model];
				for (const key of Object.keys(PRICES)) {
					if (model.indexOf(key) === 0) return PRICES[key];
				}
			}
			return PRICES[FALLBACK_MODEL];
		}

		function isPeak(now) {
			const cst = new Date(now + CST_OFFSET_MS);
			const day = cst.getUTCDay();
			if (day === 0 || day === 6) return false;
			const hour = cst.getUTCHours() + cst.getUTCMinutes() / 60;
			for (const [from, to] of PEAK_WINDOWS_CST) {
				if (hour >= from && hour < to) return true;
			}
			return false;
		}

		function formatMoney(cny) {
			if (!Number.isFinite(cny) || cny <= 0) return "¥0.00";
			if (cny < 0.01) return "¥" + cny.toFixed(4);
			return "¥" + cny.toFixed(2);
		}

		function formatBalance(amount) {
			if (!Number.isFinite(amount)) return "—";
			if (amount > 0 && amount < 0.01) return "<¥0.01";
			return "¥" + amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
		}

		function summarizeBalance(balance) {
			if (balance === undefined || balance === null || balance.status !== "ready") return undefined;
			const wallets = [...(balance.value || []), ...(balance.bonusWallets || [])];
			const pick = (currency) => wallets.filter((wallet) => wallet !== null && typeof wallet === "object" && wallet.currency === currency);
			const cny = pick("CNY");
			const chosen = cny.length > 0 ? cny : pick("USD");
			if (chosen.length === 0) return undefined;
			const currency = chosen[0].currency;
			let total = 0;
			for (const wallet of chosen) {
				const value = Number.parseFloat(wallet.balance);
				if (Number.isFinite(value)) total += value;
			}
			const sumOf = (list) => list.filter((wallet) => wallet.currency === currency).reduce((sum, wallet) => sum + (Number.parseFloat(wallet.balance) || 0), 0);
			return { currency, total, toppedUp: sumOf(balance.value || []), granted: sumOf(balance.bonusWallets || []) };
		}

		function useMinuteTick() {
			const [now, setNow] = React.useState(() => Date.now());
			React.useEffect(() => {
				const timer = setInterval(() => setNow(Date.now()), 60000);
				return () => clearInterval(timer);
			}, []);
			return now;
		}

		/**
		 * 直接订阅一个会话投影，不依赖标准 useProjection。
		 * @param sessions - 注入的 sessions 服务。
		 * @param sessionId - 当前会话。
		 * @param key - 投影名。
		 */
		function useFace(sessions, sessionId, key) {
			const face = React.useMemo(() => {
				if (sessions === undefined || sessionId === undefined) return undefined;
				try {
					const binding = sessions.binding(sessionId);
					if (binding === undefined || binding === null) return undefined;
					return binding.session.projections.faceOf(key);
				} catch (error) {
					report("projection " + key, error);
					return undefined;
				}
			}, [sessions, sessionId, key]);
			const subscribe = React.useCallback((listener) => (face === undefined ? () => {} : face.subscribe(listener)), [face]);
			const getSnapshot = React.useCallback(() => (face === undefined ? undefined : face.getSnapshot()), [face]);
			return React.useSyncExternalStore(subscribe, getSnapshot, () => undefined);
		}

		function useBalance(remote) {
			const [state, setState] = React.useState({ phase: "loading", summary: undefined });
			React.useEffect(() => {
				let alive = true;
				const load = () => {
					const account = remote === undefined || remote === null ? undefined : remote.account;
					if (account === undefined || account === null || typeof account.getBalance !== "function") {
						if (alive) setState({ phase: "unavailable", summary: undefined });
						return;
					}
					let request;
					try {
						request = account.getBalance({
							version: CLIENT_VERSION,
							locale: typeof navigator === "object" && typeof navigator.language === "string" ? navigator.language : "zh-CN",
							timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60
						});
					} catch (error) {
						report("getBalance", error);
						if (alive) setState({ phase: "unavailable", summary: undefined });
						return;
					}
					Promise.resolve(request).then((result) => {
						if (!alive) return;
						const summary = result !== null && typeof result === "object" && result.ok === true ? summarizeBalance(result.value) : undefined;
						setState(summary === undefined ? { phase: "unavailable", summary: undefined } : { phase: "ready", summary });
					}, (error) => {
						report("getBalance result", error);
						if (alive) setState({ phase: "unavailable", summary: undefined });
					});
				};
				load();
				const timer = setInterval(load, BALANCE_REFRESH_MS);
				return () => {
					alive = false;
					clearInterval(timer);
				};
			}, [remote]);
			return state;
		}

		function renderChips(props) {
			const sessions = props.sessions;
			const sessionId = props.sessionId;
			const usage = useFace(sessions, sessionId, "tokenUsage");
			const selection = useFace(sessions, sessionId, "modelSelection");
			const now = useMinuteTick();
			const balance = useBalance(props.remote);

			const uncached = usage === undefined || usage === null ? 0 : (usage.uncachedInputTokens || 0);
			const cacheRead = usage === undefined || usage === null ? 0 : (usage.cacheReadTokens || 0);
			const cacheWrite = usage === undefined || usage === null ? 0 : (usage.cacheWriteTokens || 0);
			const output = usage === undefined || usage === null ? 0 : (usage.outputTokens || 0);

			const selected = selection === undefined || selection === null ? undefined : (selection.lastUsed || selection.next);
			const model = selected === undefined || selected === null ? undefined : selected.model;
			const price = priceFor(model);
			const peak = isPeak(now);
			const ratio = peak ? 1 : OFF_PEAK_RATIO;
			const cost = ((uncached * price.cacheMiss + cacheRead * price.cacheHit + output * price.output) / 1e6) * ratio;
			const windowLabel = peak ? "峰价" : "谷价";

			const summary = balance.phase === "ready" ? balance.summary : undefined;
			const symbol = summary !== undefined && summary.currency === "USD" ? "$" : "¥";
			const balanceText = summary === undefined ? "—" : summary.currency === "USD" ? "$" + summary.total.toFixed(2) : formatBalance(summary.total);
			const balanceTitle = summary === undefined
				? balance.phase === "loading" ? "余额读取中" : "余额不可用（可能未登录，或接口暂不可达）"
				: "余额合计 " + balanceText + "\n充值 " + symbol + summary.toppedUp.toFixed(2) + " · 赠金 " + symbol + summary.granted.toFixed(2);

			const costTitle = [
				"本次会话估算（" + windowLabel + "）",
				"未缓存输入 " + uncached + " · 缓存读取 " + cacheRead + " · 缓存写入 " + cacheWrite + " · 输出 " + output,
				"单价 元/百万 tokens：命中 " + price.cacheHit + " · 未命中 " + price.cacheMiss + " · 输出 " + price.output,
				"按当前时段单价估算，不是官方账单；跨峰谷的会话和法定节假日会有偏差。"
			].join("\n");

			return h("span", { className: "dsh-usage-chips", style: { order: 99 } },
				h("span", { title: "工作日 9:00-12:00、14:00-18:00 为高峰时段（北京时间）" }, windowLabel),
				h("span", { className: "dsh-usage-chips__sep" }, "·"),
				h("span", { title: costTitle }, "估算 ", h("span", { className: "dsh-usage-chips__value" }, formatMoney(cost))),
				h("span", { className: "dsh-usage-chips__sep" }, "·"),
				h("span", { title: balanceTitle }, "余额 ", h("span", { className: "dsh-usage-chips__value" }, balanceText))
			);
		}

		/** 出错时也要在那一行留下痕迹，避免"什么都没发生"。 */
		function UsageChips(props) {
			try {
				return renderChips(props);
			} catch (error) {
				report("render", error);
				return h("span", { className: "dsh-usage-chips dsh-usage-chips__error", title: String(error && error.stack ? error.stack : error), style: { order: 99 } },
					"用量 ✕ ",
					String(error && error.message ? error.message : error)
				);
			}
		}

		/** 一次性自检：确认插件已加载，并显示当前 DSH 版本里槽位是否就绪。 */
		function DiagnosticToast() {
			const [hidden, setHidden] = React.useState(false);
			React.useEffect(() => {
				const timer = setTimeout(() => setHidden(true), 6000);
				return () => clearTimeout(timer);
			}, []);
			if (hidden) return null;
			return h("div", { className: "dsh-usage-toast" },
				"用量插件 v0.2.1 已加载。若输入框那一行没有「谷价 · 估算 · 余额」，说明 composer.dock 槽位没挂载，请把这条截图发我。"
			);
		}

		function apply(ctx) {
			try {
				ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
					name: "conversation.composer.dock",
					id: "usage-chips",
					order: 3,
					inject: () => ({ sessions: ctx.sessions, remote: ctx.remote })
				}, UsageChips));
			} catch (error) {
				report("register composer.dock", error);
			}
			try {
				ctx.slots.inject("shell.overlay", () => ctx.slots.register({ name: "shell.overlay" }, DiagnosticToast));
			} catch (error) {
				report("register diagnostic", error);
			}
		}

		const inject = ["slots", "sessions", "remote"];

		exports.UsageChips = UsageChips;
		exports.apply = apply;
		exports.inject = inject;
		exports.__internals = { priceFor, isPeak, formatMoney, formatBalance, summarizeBalance };
		return module.exports;
	}
});
