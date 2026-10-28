# dsh-usage-bar

> 让 DeepSeek Harness 的底部状态条告诉你：这个会话到现在用了多少 token、大概花了多少钱。

[English](README_en.md) | 中文

<table align="center" border="0" cellspacing="0" cellpadding="0">
  <tr>
    <td align="center" valign="top">
      <img src="assets/mp-qr.jpg" width="200" alt="公众号二维码" /><br>
      <b>公众号：扫码关注</b>
    </td>
    <td width="40"></td>
    <td align="center" valign="top">
      <img src="assets/wechat-qr.jpg" width="200" alt="微信二维码" /><br>
      <b>微信：周杰 律师</b>
    </td>
  </tr>
</table>

## 它解决什么问题

DSH 里 token 信息其实是分散的：每条回复下面有用量明细，设置 → 账号与余额 能看到余额，但想知道"这个会话累计烧了多少、折合多少钱"，得自己去官方价目表乘一遍。

这个插件把这件事放到界面上：三栏下方那条空着的底边，变成一行常驻状态，随会话实时累加。

![状态条示意图](assets/usage-bar-preview.svg)

## 显示内容

| 字段 | 含义 |
| --- | --- |
| 输入 | 未缓存输入 + 缓存读取（即计费的输入总量） |
| 命中 | 缓存读取占输入的比例 |
| 输出 | 输出 token |
| 高峰 / 空闲 | 当前所处的官方计价时段 |
| 估算 | 按当前时段单价折算的人民币金额 |

鼠标悬停显示完整拆分：未缓存输入、缓存读取、缓存写入、输出各自的数量，当前模型的单价，以及"这是估算、不是账单"的提示。

数据来自 DSH 的 `tokenUsage` 会话投影，累计整个会话的持久日志，刷新页面不会清零。

## 快速开始

### 方式一：从插件市场安装

在 **插件 → 实验性插件** 里打开 **自定义插件市场**，然后到 **发现 → 添加索引源**，粘贴：

```text
https://jayden645253207-hub.github.io/dsh-usage-bar/index.json
```

搜索 `dsh-usage-bar` 安装，重启 DSH。

### 方式二：命令行安装

```sh
dsh plugin --profile desktop add git+https://github.com/jayden645253207-hub/dsh-usage-bar.git
```

装完重启 DSH。这个包同时声明了 `dsh.bundle`，所以安装后会被登记成 profile 的一层，不需要再手动改 `cordis.patch.yml`。

### 方式三：本地联调

```sh
git clone https://github.com/jayden645253207-hub/dsh-usage-bar.git
cd dsh-usage-bar
./install.sh          # 软链进 ~/.dsh/profiles/desktop，并追加一条 insert
```

`./uninstall.sh` 撤销。改 `lib/client.js` 后刷新页面即可看到变化。

## 计价口径

金额 = （未缓存输入 × 未命中单价 + 缓存读取 × 命中单价 + 输出 × 输出单价）÷ 1,000,000 × 时段系数

价目表取自 [DeepSeek 官方定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)（2026-10-26），单位：**元 / 百万 tokens，高峰时段价**。

| 模型 | 缓存命中 | 缓存未命中 | 输出 |
| --- | --- | --- | --- |
| `deepseek-flash` | 0.04 | 2 | 8 |
| `deepseek-v4-pro` | 0.30 | 9.0 | 27.0 |

- 空闲时段价格是高峰的一半（时段系数 0.5）。
- 高峰时段：北京时间周一至周五 9:00–12:00、14:00–18:00。
- 缓存写入不单独计费（已含在未命中的输入里），只在悬停明细里展示，避免重复计价。

改价只需要改 `lib/client.js` 顶部的 `PRICES` 和 `PEAK_WINDOWS_CST` 两个常量。

### 三个已知偏差

1. **法定节假日没有建模**。官方规定节假日全天空闲，这里会把节假日里的工作时段按高峰计价，偏高。
2. **跨峰谷的长会话**按"当前时段单价 × 累计 token"估算，不是逐次计价的精确值。
3. 它**不是账单**。真实扣费以 Platform 的「账号与余额 → 查询用量」为准。

## 它怎么工作

DSH 的插件是"双面包"：宿主半边 + 浏览器半边。

- `lib/index.js`（宿主）是空的。它存在的意义是让这个包能进 Cordis 插件树——宿主只扫描树里的条目来组装浏览器的启动清单。
- `package.json` 的 `dsh.client` 声明暴露 `./client` 这个浏览器入口；宿主把它拼进 `/plugins` 路由下发。
- `lib/client.js` 是一个 `window.__ModuleLoader__.load({ id, factory })` 包，只 `require("react")`（平台内建种子模块），没有第三方依赖。
- 界面挂在 `shell.bottom` 插槽上，这是 DSH 声明给"三栏下方整行"的位置，本来是空的；没有会话时组件返回 `null`，不占高度。
- 当前会话的判定用 `sessions.list` 里 `retainedBy.mainView > 0` 的那一条，和 DSH 自己的 `uiSession.publishMain()` 用同一个判据，不依赖私有服务。
- 金额每分钟随峰谷时段重算一次。

## 目录结构

```text
.
├── lib/
│   ├── client.js        # 浏览器半边：状态条组件 + 计价
│   └── index.js         # 宿主半边：空实现
├── cordis.patch.yml     # 作为 bundle 安装时插入自己的那一层
├── market/index.json    # 本仓库自带的插件市场索引（GitHub Pages 托管）
├── market/icons/        # 索引引用的图标
├── scripts/build-market-index.mjs
├── install.sh / uninstall.sh   # 本地联调用的软链安装
├── assets/              # 示意图与二维码
└── icon.svg
```

## 已验证的范围

- 计价、峰谷边界（含 12:00 / 18:00 的开闭区间、周末）、金额格式：有单元测试，全部通过。
- 开发与自用环境：macOS 桌面版，DSH `0.2.1-rc.3`。

没有验证：Windows、其他 DSH 版本、多个主会话并存的极端情况。DSH 的插槽和投影属于内部契约，版本升级后有可能失效；失效时先看浏览器控制台有没有 `shell.bottom` 或 `client-modules` 的报错。

## 反馈

- 问题与复现：[GitHub Issues](https://github.com/jayden645253207-hub/dsh-usage-bar/issues)
- 持续内容与更新：公众号（上方二维码）
- 其他联系：微信（上方二维码）

## 许可证

[MIT](LICENSE) © 2026 周杰
