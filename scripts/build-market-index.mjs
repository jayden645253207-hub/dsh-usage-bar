#!/usr/bin/env node
// Build the format-1 plugin market index served by GitHub Pages (docs/).
//
//   node scripts/build-market-index.mjs
//
// The index pins the current HEAD commit, so run it AFTER committing the plugin
// code, then commit docs/index.json. Re-run on every release: the install spec is
// git+<url>#<commit>, and a stale commit ships stale code.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const commit = git("rev-parse", "HEAD");
if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("HEAD is not a 40-hex commit: " + commit);
const publishTimestamp = Number(git("log", "-1", "--format=%ct", "HEAD"));
const repoUrl = "https://github.com/jayden645253207-hub/dsh-usage-bar";

const index = {
  format: 1,
  title: { en: "jayden's DSH plugins", zh: "周杰的 DSH 插件" },
  description: {
    en: "Small DeepSeek Harness plugins by 周杰.",
    zh: "周杰自用并整理出来的 DeepSeek Harness 小插件。"
  },
  metadata: {
    categories: { interface: { title: { en: "Interface", zh: "界面" } } },
    labels: { usage: { title: { en: "Usage", zh: "用量" } } }
  },
  plugins: [
    {
      name: pkg.name,
      title: { en: "Usage bar", zh: "用量状态条" },
      description: {
        en: "Session token usage and estimated cost (CNY) in the Harness bottom bar.",
        zh: "在 Harness 底部状态条显示本次会话的 token 用量与估算金额（人民币）。"
      },
      icon: "icons/dsh-usage-bar.svg",
      author: "周杰 (jayden645253207-hub)",
      homepage: repoUrl + "#readme",
      repository: { url: repoUrl },
      metadata: { category: "interface", labels: ["usage"] },
      versions: [
        {
          version: pkg.version,
          publishTimestamp,
          source: { type: "git", url: repoUrl, commit },
          ...(pkg.engines?.dsh === undefined ? {} : { engines: { dsh: pkg.engines.dsh } })
        }
      ]
    }
  ]
};

mkdirSync(join(root, "docs/icons"), { recursive: true });
copyFileSync(join(root, "icon.svg"), join(root, "docs/icons/dsh-usage-bar.svg"));
writeFileSync(join(root, "docs/index.json"), JSON.stringify(index, null, 2) + "\n");
console.log(`docs/index.json -> ${pkg.name}@${pkg.version} @ ${commit.slice(0, 12)}`);
