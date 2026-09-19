#!/usr/bin/env node
/**
 * i18n 一致性检查（开发用，不影响线上）
 *
 * 跑 `npm run check` 或 `node scripts/check-i18n.mjs`，检查 4 件事：
 *   1. src/api/bowls.js 的 INSERT / UPDATE：列数 = 占位符 + 字面量，且占位符数 = bind 参数数
 *      （多币种改造后这两条语句有 40+ 个字段，最容易手滑漏一个）
 *   2. 服务端文案包 src/lib/locales.js：err / notify / og / feed 四块键名中英对应
 *   3. 前端文案包 static/i18n/{en,zh}.json：逐 key 对齐
 *   4. 代码里 t()/tp() 引用的文案 key 是否真实存在
 *   5. 脚本里是否还有硬编码中文（注释与文案包本身除外）
 *
 * 任何一项不过就以退出码 1 结束，方便接进 CI。
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(resolve(ROOT, rel), "utf8");

let failures = 0;
const ok = (msg) => console.log(`  OK   ${msg}`);
const bad = (msg) => {
  failures++;
  console.log(`  FAIL ${msg}`);
};

// 按顶层逗号切分（忽略括号/花括号/方括号内的逗号）
function splitTop(x) {
  let depth = 0;
  let count = 1;
  for (const c of x) {
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) count++;
  }
  return count;
}

console.log("\n1) SQL 占位符与 bind 参数");
{
  const src = read("src/api/bowls.js");

  // createBowl 的 INSERT
  const insCols = /INSERT INTO bowls\s*\(([\s\S]*?)\)\s*VALUES/.exec(src);
  const insVals = /INSERT INTO bowls[\s\S]*?VALUES \(([\s\S]*?)\)`/.exec(src);
  const insBind = /INSERT INTO bowls[\s\S]*?\.bind\(([\s\S]*?)\)\s*\.run\(\)/.exec(src);
  if (!insCols || !insVals || !insBind) {
    bad("createBowl 的 INSERT 没匹配到（SQL 结构变了？）");
  } else {
    const cols = insCols[1].split(",").filter((x) => x.trim()).length;
    const ph = (insVals[1].match(/\?/g) || []).length;
    const lits = (insVals[1].match(/'active'/g) || []).length;
    const binds = splitTop(insBind[1]);
    cols === ph + lits && ph === binds
      ? ok(`createBowl INSERT  列=${cols} 占位符=${ph} 字面量=${lits} bind=${binds}`)
      : bad(`createBowl INSERT  列=${cols} 占位符=${ph} 字面量=${lits} bind=${binds}`);
  }

  // updateBowl 的 UPDATE
  const upSrc = src.slice(src.indexOf("export async function updateBowl"));
  const setPart = /UPDATE bowls SET([\s\S]*?)\n\s*WHERE id=\?/.exec(upSrc);
  const upBind = /UPDATE bowls SET[\s\S]*?\.bind\(([\s\S]*?)\)\s*\.run\(\)/.exec(upSrc);
  if (!setPart || !upBind) {
    bad("updateBowl 的 UPDATE 没匹配到（SQL 结构变了？）");
  } else {
    const set = setPart[1];
    const assigns = set.split(",").filter((x) => x.trim()).length;
    const setPh = (set.match(/\?/g) || []).length;
    const setLits = (set.match(/datetime\('now'\)/g) || []).length;
    const stmtPh = setPh + 1; // + WHERE id=?
    const binds = splitTop(upBind[1]);
    assigns === setPh + setLits && stmtPh === binds
      ? ok(`updateBowl UPDATE  SET赋值=${assigns} 占位符=${setPh} 字面量=${setLits} bind=${binds}`)
      : bad(`updateBowl UPDATE  SET赋值=${assigns} 占位符=${setPh} 字面量=${setLits} bind=${binds}`);
  }
}

// 从 locales.js 源码里按 `const xx = {` 取出某个顶层块的键名
// 结构是 zh = { err: {...}, feed: {...}, notify: {...}, og: {...} }
// 顶层块缩进 2 空格，块内 key 缩进 4 空格
function topLevelKeys(source, name) {
  const start = source.indexOf(`  ${name}: {`);
  if (start < 0) return [];
  const end = source.indexOf("\n  },", start);
  const body = source.slice(start, end < 0 ? source.length : end);
  return [...body.matchAll(/^\s{4}([A-Za-z][A-Za-z0-9]*):/gm)].map((m) => m[1]);
}

console.log("\n2) 服务端文案包 locales.js");
{
  const loc = read("src/lib/locales.js");
  const zhStart = loc.indexOf("const zh = {");
  const enStart = loc.indexOf("const en = {");
  for (const group of ["err", "notify", "og", "feed"]) {
    const zh = topLevelKeys(loc.slice(zhStart, enStart), group);
    const en = topLevelKeys(loc.slice(enStart), group);
    const missEn = zh.filter((k) => !en.includes(k));
    const missZh = en.filter((k) => !zh.includes(k));
    missEn.length || missZh.length
      ? bad(`${group}: 仅 zh 有 [${missEn.join(", ")}] 仅 en 有 [${missZh.join(", ")}]`)
      : ok(`${group}: ${zh.length} 个键中英对齐`);
  }
}

console.log("\n3) 前端文案包 static/i18n/*.json");
{
  const en = JSON.parse(read("static/i18n/en.json"));
  const zh = JSON.parse(read("static/i18n/zh.json"));
  const flat = (o, p = "") =>
    Object.entries(o).flatMap(([k, v]) =>
      Array.isArray(v) ? [`${p}${k}`] : v && typeof v === "object" ? flat(v, `${p}${k}.`) : [`${p}${k}`]
    );
  const a = new Set(flat(en));
  const b = new Set(flat(zh));
  const missEn = [...b].filter((k) => !a.has(k));
  const missZh = [...a].filter((k) => !b.has(k));
  missEn.length || missZh.length
    ? bad(`en=${a.size} zh=${b.size} | 仅 zh 有 [${missEn.join(", ")}] 仅 en 有 [${missZh.join(", ")}]`)
    : ok(`en=${a.size} zh=${b.size} 完全对齐`);
}

console.log("\n4) 代码里引用的文案 key 是否都存在");
{
  const { LOCALES } = await import(new URL("../src/lib/locales.js", import.meta.url));
  const has = (locale, path) =>
    path.split(".").reduce((acc, k) => (acc == null ? undefined : acc[k]), LOCALES[locale]) !== undefined;

  const files = [
    "src/index.js", "src/assets.js",
    "src/api/bowls.js", "src/api/donations.js", "src/api/upload.js",
    "src/api/admin.js", "src/api/og.js",
    "src/lib/db.js", "src/lib/notify.js", "src/lib/i18n.js",
  ];
  const missing = new Set();
  for (const rel of files) {
    if (!existsSync(resolve(ROOT, rel))) continue;
    // t(locale, "a.b") / tp(locale, "a.b") / t(L, "a.b")
    for (const m of read(rel).matchAll(/\btp?\(\s*(?:locale|L)\s*,\s*"([^"]+)"/g)) {
      for (const loc of ["en", "zh"]) if (!has(loc, m[1])) missing.add(`${m[1]} (${loc}) ← ${rel}`);
    }
  }
  missing.size === 0
    ? ok("服务端引用的文案 key 全部存在")
    : bad(`以下 key 不存在：\n       ${[...missing].join("\n       ")}`);
}

console.log("\n5) 硬编码中文残留");
{
  const isComment = (line) => /^\s*(\/\/|\*|\/\*|#|--)/.test(line);
  const scan = (rel) => {
    if (!existsSync(resolve(ROOT, rel))) return 0;
    let hits = 0;
    read(rel).split("\n").forEach((line, i) => {
      if (isComment(line)) return;
      const m = line.match(/"[^"]*[\u4e00-\u9fff][^"]*"|`[^`]*[\u4e00-\u9fff][^`]*`|'[^']*[\u4e00-\u9fff][^']*'/);
      if (!m) return;
      // 语言切换器上「中文」两个字本来就该用母语写
      if (rel === "static/js/i18n.js" && /SWITCH_LABELS/.test(line)) return;
      hits++;
      console.log(`       ${rel}:${i + 1}  ${line.trim().slice(0, 90)}`);
    });
    return hits;
  };

  let total = 0;
  for (const rel of [
    "src/index.js", "src/assets.js",
    "src/api/bowls.js", "src/api/donations.js", "src/api/upload.js",
    "src/api/admin.js", "src/api/og.js",
    "src/lib/db.js", "src/lib/notify.js", "src/lib/validate.js",
    "src/lib/i18n.js", "src/lib/og-render.js", "src/lib/turnstile.js", "src/lib/ip.js",
    "static/js/api.js", "static/js/i18n.js", "static/js/index.js",
    "static/js/create.js", "static/js/bowl.js", "static/js/admin.js",
  ]) total += scan(rel);

  total === 0 ? ok("服务端与前端脚本里没有硬编码中文") : bad(`还有 ${total} 处字符串字面量含中文`);
}

console.log(failures === 0 ? "\n全部通过 ✅\n" : `\n${failures} 项未通过 ❌\n`);
process.exit(failures === 0 ? 0 : 1);
