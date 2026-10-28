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

		const CSS = [
			".dsh-usage-bar{display:flex;align-items:center;justify-content:space-between;gap:16px;",
			"box-sizing:border-box;min-height:26px;padding:3px 14px;font-size:12px;line-height:18px;",
			"font-variant-numeric:tabular-nums;user-select:none;white-space:nowrap;",
			"border-top:0.5px solid var(--dsw-alias-border-l2,#00000014);",
			"background:var(--dsw-alias-bg-base,transparent);",
			"color:var(--dsw-alias-label-tertiary,#8a8a8a)}",
			".dsh-usage-bar__group{display:flex;align-items:center;gap:10px;min-width:0;overflow:hidden}",
			".dsh-usage-bar__label{color:var(--dsw-alias-label-caption,#a0a0a0)}",
			".dsh-usage-bar__value{color:var(--dsw-alias-label-tertiary,#8a8a8a)}",
			".dsh-usage-bar__cost{color:var(--dsw-alias-label-primary,#1f1f1f);font-weight:500}",
			".dsh-usage-bar__window{color:var(--dsw-alias-label-caption,#a0a0a0)}"
		].join("");

		const STYLE_KEY = "dsh-usage-bar/style.css";
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

		function formatTokens(value) {
			if (!Number.isFinite(value) || value <= 0) return "0";
			if (value < 1000) return String(Math.round(value));
			if (value < 1e6) return (value / 1000).toFixed(value < 1e4 ? 2 : 1) + "k";
			return (value / 1e6).toFixed(2) + "M";
		}

		function formatMoney(cny) {
			if (!Number.isFinite(cny) || cny <= 0) return "¥0.00";
			if (cny < 0.01) return "¥" + cny.toFixed(4);
			return "¥" + cny.toFixed(2);
		}

		/**
		 * 订阅一个会话投影。
		 * @param sessions - 注入的 sessions 服务。
		 * @param sessionId - 当前主会话，未打开会话时为 undefined。
		 * @param key - 投影名（tokenUsage / modelSelection）。
		 */
		function useProjection(sessions, sessionId, key) {
			const face = React.useMemo(() => {
				if (sessionId === undefined) return undefined;
				try {
					const binding = sessions.binding(sessionId);
					if (binding === undefined || binding === null) return undefined;
					return binding.session.projections.faceOf(key);
				} catch (error) {
					return undefined;
				}
			}, [sessions, sessionId, key]);
			const subscribe = React.useCallback((listener) => (face === undefined ? () => {} : face.subscribe(listener)), [face]);
			const getSnapshot = React.useCallback(() => (face === undefined ? undefined : face.getSnapshot()), [face]);
			return React.useSyncExternalStore(subscribe, getSnapshot, () => undefined);
		}

		/** 每分钟重渲染一次，让「高峰 / 空闲」跟着时钟走。 */
		function useMinuteTick() {
			const [now, setNow] = React.useState(() => Date.now());
			React.useEffect(() => {
				const timer = setInterval(() => setNow(Date.now()), 60000);
				return () => clearInterval(timer);
			}, []);
			return now;
		}

		function UsageBar(props) {
			const sessions = props.sessions;
			const useSessions = props.useSessions;
			const sessionId = useSessions((state) => {
				if (state === undefined || state === null || state.byId === undefined) return undefined;
				const entries = Object.keys(state.byId);
				for (const id of entries) {
					const entry = state.byId[id];
					const retained = entry === undefined || entry.retainedBy === undefined ? 0 : entry.retainedBy.mainView;
					if ((retained === undefined ? 0 : retained) > 0) return id;
				}
				if (entries.length === 1 && state.phase === "ready") return entries[0];
				return undefined;
			});
			const usage = useProjection(sessions, sessionId, "tokenUsage");
			const selection = useProjection(sessions, sessionId, "modelSelection");
			const now = useMinuteTick();

			if (sessionId === undefined) return null;

			const uncached = usage === undefined || usage === null ? 0 : (usage.uncachedInputTokens || 0);
			const cacheRead = usage === undefined || usage === null ? 0 : (usage.cacheReadTokens || 0);
			const cacheWrite = usage === undefined || usage === null ? 0 : (usage.cacheWriteTokens || 0);
			const output = usage === undefined || usage === null ? 0 : (usage.outputTokens || 0);
			const total = uncached + cacheRead + output;

			if (usage === undefined || usage === null || total === 0) {
				return h("div", { className: "dsh-usage-bar", role: "status" },
					h("div", { className: "dsh-usage-bar__group" },
						h("span", { className: "dsh-usage-bar__label" }, "本次会话"),
						h("span", { className: "dsh-usage-bar__value" }, "暂无用量记录")
					)
				);
			}

			const selected = selection === undefined || selection === null ? undefined : (selection.lastUsed || selection.next);
			const model = selected === undefined || selected === null ? undefined : selected.model;
			const price = priceFor(model);
			const peak = isPeak(now);
			const ratio = peak ? 1 : OFF_PEAK_RATIO;
			const cost = ((uncached * price.cacheMiss + cacheRead * price.cacheHit + output * price.output) / 1e6) * ratio;
			const billedInput = uncached + cacheRead;
			const hitRate = billedInput > 0 ? Math.round((cacheRead / billedInput) * 100) : 0;
			const windowLabel = peak ? "高峰时段" : "空闲时段";

			const title = [
				"模型：" + (model || FALLBACK_MODEL) + "（" + windowLabel + "）",
				"未缓存输入：" + uncached + " tokens",
				"缓存读取：" + cacheRead + " tokens",
				"缓存写入：" + cacheWrite + " tokens",
				"输出：" + output + " tokens",
				"单价（元 / 百万 tokens）：命中 " + price.cacheHit + " · 未命中 " + price.cacheMiss + " · 输出 " + price.output,
				"金额按当前时段单价估算，不是官方账单；跨峰谷的会话和法定节假日会有偏差。"
			].join("\n");

			return h("div", { className: "dsh-usage-bar", role: "status", title },
				h("div", { className: "dsh-usage-bar__group" },
					h("span", { className: "dsh-usage-bar__label" }, "本次会话"),
					h("span", { className: "dsh-usage-bar__value" }, "输入 " + formatTokens(billedInput)),
					h("span", { className: "dsh-usage-bar__value" }, "命中 " + hitRate + "%"),
					h("span", { className: "dsh-usage-bar__value" }, "输出 " + formatTokens(output))
				),
				h("div", { className: "dsh-usage-bar__group" },
					h("span", { className: "dsh-usage-bar__window" }, windowLabel),
					h("span", { className: "dsh-usage-bar__cost" }, "估算 " + formatMoney(cost))
				)
			);
		}

		/**
		 * 客户端插件主体：占满宽的底部插槽，只放一个占位者。
		 * @param ctx - 客户端根上下文。
		 */
		function apply(ctx) {
			ctx.slots.inject("shell.bottom", () => ctx.slots.register({
				name: "shell.bottom",
				inject: () => ({ sessions: ctx.sessions })
			}, UsageBar));
		}

		const inject = ["slots", "sessions"];

		exports.UsageBar = UsageBar;
		exports.apply = apply;
		exports.inject = inject;
		exports.__internals = { priceFor, isPeak, formatTokens, formatMoney };
		return module.exports;
	}
});
