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
		// 法定节假日没有建模，节假日里的工作时段会被按高峰计价（略高估）。
		// 官方调价时改这张表即可。
		// ---------------------------------------------------------------------
		const PRICES = {
			"deepseek-flash": { cacheHit: 0.04, cacheMiss: 2, output: 8 },
			"deepseek-v4-flash": { cacheHit: 0.04, cacheMiss: 2, output: 8 },
			"deepseek-v4-pro": { cacheHit: 0.3, cacheMiss: 9, output: 27 }
		};
		const FALLBACK_MODEL = "deepseek-flash";
		const OFF_PEAK_RATIO = 0.5;
		// 北京时间高峰时段（小时，左闭右开）。
		const PEAK_WINDOWS_CST = [
			[9, 12],
			[14, 18]
		];
		const CST_OFFSET_MS = 8 * 60 * 60 * 1000;

		// 账号接口要求的客户端元数据。version 只进 x-client-version 请求头，
		// 与 DSH 自身的桌面客户端保持同一口径；升级 DSH 后跟着改即可。
		const CLIENT_VERSION = "0.2.1-rc.3";
		const BALANCE_REFRESH_MS = 60000;

		const CSS = [
			".dsh-usage-chips{display:inline-flex;align-items:center;gap:6px;font-size:13px;",
			"line-height:20px;font-variant-numeric:tabular-nums;white-space:nowrap;user-select:none;",
			"color:var(--dsw-alias-label-tertiary,#8a8a8a)}",
			".dsh-usage-chips__sep{color:var(--dsw-alias-label-dimmed,#c0c0c0)}",
			".dsh-usage-chips__value{color:var(--dsw-alias-label-primary,#1f1f1f);font-weight:500}"
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

		/** 北京时间是否处于官方高峰时段（周一到周五，9-12 / 14-18）。 */
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

		/** 把账号接口的余额结构折成「一个币种 + 充值 + 赠金」。 */
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
			const toppedUp = (balance.value || []).filter((wallet) => wallet.currency === currency).reduce((sum, wallet) => sum + (Number.parseFloat(wallet.balance) || 0), 0);
			const granted = (balance.bonusWallets || []).filter((wallet) => wallet.currency === currency).reduce((sum, wallet) => sum + (Number.parseFloat(wallet.balance) || 0), 0);
			return { currency, total, toppedUp, granted };
		}

		/** 每分钟重渲染一次，让「峰价 / 谷价」跟着时钟走。 */
		function useMinuteTick() {
			const [now, setNow] = React.useState(() => Date.now());
			React.useEffect(() => {
				const timer = setInterval(() => setNow(Date.now()), 60000);
				return () => clearInterval(timer);
			}, []);
			return now;
		}

		/** 读一次账号余额，并每分钟刷新。 */
		function useBalance(account) {
			const [state, setState] = React.useState({ phase: "loading", summary: undefined });
			React.useEffect(() => {
				if (account === undefined || account === null) {
					setState({ phase: "unavailable", summary: undefined });
					return undefined;
				}
				let alive = true;
				const load = () => {
					let request;
					try {
						request = account.getBalance({
							version: CLIENT_VERSION,
							locale: typeof navigator === "object" && typeof navigator.language === "string" ? navigator.language : "zh-CN",
							timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60
						});
					} catch (error) {
						return;
					}
					Promise.resolve(request).then((result) => {
						if (!alive) return;
						const summary = result !== null && typeof result === "object" && result.ok === true ? summarizeBalance(result.value) : undefined;
						setState(summary === undefined ? { phase: "unavailable", summary: undefined } : { phase: "ready", summary });
					}, () => {
						if (alive) setState({ phase: "unavailable", summary: undefined });
					});
				};
				load();
				const timer = setInterval(load, BALANCE_REFRESH_MS);
				return () => {
					alive = false;
					clearInterval(timer);
				};
			}, [account]);
			return state;
		}

		/**
		 * 输入框下方那一行的三个字段：峰/谷价 · 估算 · 余额。
		 * 注册在 conversation.composer.dock，排在 44% 的后面。
		 */
		function UsageChips(props) {
			const useProjection = props.useProjection;
			const usage = useProjection("tokenUsage");
			const selection = useProjection("modelSelection");
			const now = useMinuteTick();
			const balance = useBalance(props.account);

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
			const balanceText = summary === undefined ? "—" : summary.currency === "USD" ? "$" + summary.total.toFixed(2) : formatBalance(summary.total);
			const balanceTitle = summary === undefined
				? balance.phase === "loading" ? "余额读取中" : "余额不可用（可能未登录，或接口暂不可达）"
				: "余额合计 " + balanceText + "\n充值 " + (summary.currency === "USD" ? "$" : "¥") + summary.toppedUp.toFixed(2) + " · 赠金 " + (summary.currency === "USD" ? "$" : "¥") + summary.granted.toFixed(2);

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

		/**
		 * 客户端插件主体：在输入框下方的状态行里占一格（44% 之后）。
		 * @param ctx - 客户端根上下文。
		 */
		function apply(ctx) {
			ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
				name: "conversation.composer.dock",
				id: "usage-chips",
				order: 3,
				inject: () => ({ account: ctx.remote === undefined ? undefined : ctx.remote.account })
			}, UsageChips));
		}

		const inject = ["slots", "remote"];

		exports.UsageChips = UsageChips;
		exports.apply = apply;
		exports.inject = inject;
		exports.__internals = { priceFor, isPeak, formatMoney, formatBalance, summarizeBalance };
		return module.exports;
	}
});
