// 上游全量版本比较：逐版本列出上游改动，并对照本仓库文件的存在与规模。
//
// 前置（一次性，之后每次同步重跑本脚本即可）：
//   git fetch upstream '+refs/tags/*:refs/upstream/tags/*' --no-tags
// 说明：本地 refs/tags/v0.1.0–v0.1.9 是我们自己的发布 tag，与上游同名，
//       上游那半套只存在于 refs/upstream/tags/* 命名空间里，别用 refs/tags/* 比对。
//
// 用法：
//   node scripts/upstream-matrix.mjs                 # 打印 Markdown 到标准输出
//   node scripts/upstream-matrix.mjs --all           # 连 docs/.github/Casks 一起算
//   node scripts/upstream-matrix.mjs --thin-ratio=0.6  # 「本地偏薄」阈值（默认 0.6）
//
// 判定口径（启发式，供人复核，不当结论用）：
//   本地缺   上游新增/修改的文件在本地 HEAD 里不存在（按路径同名匹配）
//   本地偏薄 本地行数 < 上游行数 × 阈值，且上游 ≥ 60 行
//   本地更大 本地行数 > 上游行数 × 1.4（通常是我们自己走得更远，只计数）
import { execFileSync } from "node:child_process";

const repo = new URL("..", import.meta.url).pathname;
const args = process.argv.slice(2);
const includeAll = args.includes("--all");
const thinRatio = Number(
  (args.find((a) => a.startsWith("--thin-ratio=")) ?? "").split("=")[1] ?? 0.6,
);

// 上游仓库自身基建、上游文档、锁文件不进对照表（我们本来就不跟）。
const SKIP = [
  /^docs\//,
  /^\.github\//,
  /^Casks\//,
  /^src-tauri\/gen\//,
  /(^|\/)(package-lock\.json|Cargo\.lock|CHANGELOG\.md)$/,
  /^\.gitignore$/,
];

function git(...argv) {
  return execFileSync("git", argv, {
    cwd: repo,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function tryGit(...argv) {
  try {
    return git(...argv);
  } catch {
    return null;
  }
}

/** 行数；二进制按 -1 处理。 */
function lines(ref, path) {
  const out = tryGit("show", `${ref}:${path}`);
  if (out === null || out.includes("\u0000")) return -1;
  return out.split("\n").length - 1;
}

function localLines(path) {
  return lines("HEAD", path);
}

function existsLocally(path) {
  return tryGit("cat-file", "-e", `HEAD:${path}`) !== null;
}

function versionKey(name) {
  const m = name.match(/v(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}

const tags = git(
  "for-each-ref",
  "--format=%(refname:short)",
  "refs/upstream/tags/",
)
  .trim()
  .split("\n")
  .filter(Boolean)
  .sort((a, b) => {
    const [a1, a2, a3] = versionKey(a);
    const [b1, b2, b3] = versionKey(b);
    return a1 - b1 || a2 - b2 || a3 - b3;
  });

if (!tags.length) {
  console.error(
    "未找到上游 tag。先执行：\n" +
      "  git fetch upstream '+refs/tags/*:refs/upstream/tags/*' --no-tags",
  );
  process.exit(1);
}

const skipped = (path) => !includeAll && SKIP.some((re) => re.test(path));
const bucket = (path) =>
  path.startsWith("src-tauri/")
    ? "Rust"
    : path.startsWith("src/")
      ? "前端"
      : "其他";

const rows = [];
const firstSeen = new Map(); // 本地缺失/偏薄的文件 -> 首次出现的上游版本
const partialSeen = new Map();

for (let i = 1; i < tags.length; i++) {
  const prev = tags[i - 1];
  const cur = tags[i];
  const name = cur.split("/").pop();
  const head = git("log", "-1", "--format=%h %ad", "--date=short", cur).trim();
  const status = git("diff", "--find-renames", "--name-status", prev, cur)
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("\t"));
  const changed = status.filter(([, ...p]) => !skipped(p[p.length - 1]));
  const added = changed.filter(([s]) => s === "A").map(([, p]) => p);
  if (status.some(([s]) => s.startsWith("R"))) {
    for (const [, _from, to] of status.filter(([s]) => s.startsWith("R"))) {
      if (!skipped(to)) added.push(to);
    }
  }
  const touched = changed
    .filter(([s]) => s === "A" || s === "M" || s.startsWith("R"))
    .map(([, ...p]) => p[p.length - 1]);

  const missing = [];
  const thin = [];
  let bigger = 0;
  for (const path of touched) {
    const up = lines(cur, path);
    if (up <= 0) continue;
    if (!existsLocally(path)) {
      missing.push(`${path} (${up})`);
      if (!firstSeen.has(path)) firstSeen.set(path, name);
      continue;
    }
    const lo = localLines(path);
    if (lo < 0) continue;
    if (up >= 60 && lo < up * thinRatio) {
      thin.push(`${path} (上游 ${up} / 本地 ${lo})`);
      if (!partialSeen.has(path))
        partialSeen.set(path, { version: name, up, lo });
    } else if (lo > up * 1.4) {
      bigger++;
    }
  }

  rows.push({
    name,
    head,
    changed: changed.length,
    added: added.length,
    missing,
    thin,
    bigger,
  });
}

const out = [];
out.push("# 上游全量版本比较（脚本生成物）");
out.push("");
out.push(
  "由 `node scripts/upstream-matrix.mjs` 生成，逐上游版本对照本仓库 HEAD；" +
    "启发式判定，仅用于找候选，逐项结论仍需人工核对。",
);
out.push("");
out.push(
  `- 上游版本数：${tags.length}（${tags[0].split("/").pop()} → ${tags[tags.length - 1].split("/").pop()}）`,
);
out.push(
  `- 对照范围：${includeAll ? "全部路径" : "排除上游 docs/.github/Casks/锁文件"}`,
);
out.push(`- 「本地偏薄」阈值：本地 < 上游 × ${thinRatio}（且上游 ≥ 60 行）`);
out.push("");
out.push("## 总览");
out.push("");
out.push("| 版本 | 日期 | 改动 | 新增 | 本地缺 | 本地偏薄 | 本地更大 |");
out.push("| --- | --- | --- | --- | --- | --- | --- |");
for (const r of rows) {
  out.push(
    `| ${r.name} | ${r.head.split(" ")[1]} | ${r.changed} | ${r.added} | ${r.missing.length} | ${r.thin.length} | ${r.bigger} |`,
  );
}
out.push("");
if (firstSeen.size) {
  out.push("## 本地缺失清单（按首次出现的上游版本）");
  out.push("");
  out.push("| 文件 | 首见版本 | 所属 |");
  out.push("| --- | --- | --- |");
  for (const [path, ver] of [...firstSeen].sort((a, b) =>
    a[1].localeCompare(b[1]),
  )) {
    out.push(`| ${path} | ${ver} | ${bucket(path)} |`);
  }
  out.push("");
}
if (partialSeen.size) {
  out.push("## 本地偏薄清单（可能只搬了一部分）");
  out.push("");
  out.push("| 文件 | 首见版本 | 上游行数 | 本地上次记录行数 |");
  out.push("| --- | --- | --- | --- |");
  for (const [path, v] of partialSeen) {
    out.push(`| ${path} | ${v.version} | ${v.up} | ${v.lo} |`);
  }
  out.push("");
}
out.push("## 逐版本明细（仅列需关注项）");
for (const r of rows) {
  if (!r.missing.length && !r.thin.length) continue;
  out.push("");
  out.push(`### ${r.name}（${r.head}）`);
  for (const m of r.missing) out.push(`- 本地缺：${m}`);
  for (const t of r.thin) out.push(`- 本地偏薄：${t}`);
}
out.push("");
process.stdout.write(out.join("\n"));
