#!/usr/bin/env node
// v2-suite-manifest.mjs —— V2 新套件清单自检（MIG-02 / IMPL-02-01）
//
// 依据：plan/04 §1.9.2（清单职责）/§1.9.4（「V2 新套件绿」九条阈值，第 2/3/5 条）、
//       plan/03 §三（MIG-02 出口门禁第 3 条）、plan/05 IMPL-02-01、docs/90 §三 R5。
//
// 校验五件事（任一不满足 → exit 1）：
//   ① `vitest.v2.config.ts` 的 include **只含 test/v2**——白名单正则只放行
//      `apps|packages/*/test/v2/**/*.test.ts`，旧测试路径（`src/**`、`test/*.test.ts`、
//      `scripts/**`）在形态上即不可通过；
//   ② `test/v2` 测试文件数 > 0（静态计数；权威用例数以 `test:v2` 实跑为准）；
//   ③ `test/v2` 内无 skip / only / todo / retry 标记（plan/04 §1.9.4 第 3 条）；
//   ④ 根 `package.json` 的 `test:v2` 存在、指向本配置、不含 `--passWithNoTests`/`--retry`；
//   ⑤ 配置本身 `retry: 0`（禁重跑刷绿）。
//
// 零依赖（node:fs/node:path）；Node 24 直跑。用法：
//   node scripts/verify/v2-suite-manifest.mjs [--root <仓根>]   # 违例 exit 1
//
// 边界：本脚本**不跑** vitest（不做测试执行者），只做清单与标记面机械校验。

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CONFIG_FILE = "vitest.v2.config.ts";
const PKG_FILE = "package.json";

// include 允许的唯一形态（白名单；旧测试路径在形态上即不通过）
const ALLOWED_INCLUDE = /^(?:apps|packages)\/\*\/test\/v2\/\*\*\/\*\.test\.ts$/;

/**
 * 把 TS 注释「涂白」（替换为等长空格）而不是删除——原因有二：
 *   ① glob 里合法地含块注释起始符（双层通配：v2 后两个星号再斜杠），
 *      正则删注释会把 glob 字符串吃掉（本文件初版即踩此坑：include 解析返回 null）；
 *   ② 保留偏移量与字符串字面量，后续 `include`/`retry` 提取与禁标记扫描直接跑在涂白文本上，
 *      既不会被注释里的示例文字误命中，也不需要二次 unescape。
 * 状态机：普通 / 单引号 / 双引号 / 模板串 / 行注释 / 块注释；字符串内 `\` 转义。
 */
export function maskComments(src) {
  const out = src.split("");
  let st = "code";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (st === "code") {
      if (c === "/" && n === "/") { st = "line"; out[i] = " "; }
      else if (c === "/" && n === "*") { st = "block"; out[i] = " "; }
      else if (c === "'") st = "sq";
      else if (c === '"') st = "dq";
      else if (c === "`") st = "tpl";
    } else if (st === "line") {
      if (c === "\n") st = "code";
      else out[i] = " ";
    } else if (st === "block") {
      if (c === "*" && n === "/") { out[i] = " "; out[i + 1] = " "; i++; st = "code"; }
      else if (c !== "\n") out[i] = " ";
    } else {
      // 字符串态：字符串内容原样保留，只处理转义与收尾引号
      if (c === "\\") { i++; continue; }
      if ((st === "sq" && c === "'") || (st === "dq" && c === '"') || (st === "tpl" && c === "`")) st = "code";
    }
  }
  return out.join("");
}

/** 取 `key: [ "a", "b" ]` 的字符串项；取不到返回 null。 */
export function readStringArray(source, key) {
  const m = new RegExp(`\\b${key}\\s*:\\s*\\[([^\\]]*)\\]`).exec(source);
  if (m === null) return null;
  return [...m[1].matchAll(/(['"])((?:\\.|(?!\1)[^\\])*?)\1/g)].map((x) => x[2]);
}

/** 递归收集 dir 下（跳过 node_modules/.git/dist）后缀命中的文件，返回仓相对路径（posix）。 */
export function walkFiles(root, dir, filter) {
  const out = [];
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return out;
  const recurse = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".git" || e.name === "dist") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) recurse(p);
      else if (e.isFile() && filter(e.name)) out.push(path.relative(root, p).split(path.sep).join("/"));
    }
  };
  recurse(abs);
  return out;
}

/** V2 套件文件清单：apps/*|packages/* 的 test/v2 下全部 .ts（测试件与非测试件均收）。 */
export function v2SuiteFiles(root) {
  const all = [];
  for (const kind of ["apps", "packages"]) {
    const base = path.join(root, kind);
    if (!fs.existsSync(base)) continue;
    for (const e of fs.readdirSync(base, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      all.push(...walkFiles(root, `${kind}/${e.name}/test/v2`, (n) => n.endsWith(".ts")));
    }
  }
  return all.sort();
}

// 禁标记：skip/only/todo（含 describe.skip、test.skipIf 等价条件跳过）与 retry 选项。
const MARKER_RULES = [
  { name: "skip", re: /\b(?:it|test|describe|suite)\.skip\b|\b(?:it|test|describe)\.skipIf\s*\(/, why: "禁 skip（含 skipIf）：跳过=不该有的豁免（plan/04 §1.9.4-3）" },
  { name: "only", re: /\b(?:it|test|describe|suite)\.only\b|\b(?:it|test|describe)\.concurrent\.only\b/, why: "禁 only：只跑子集=冒充全绿（plan/04 §1.9.4-3）" },
  { name: "todo", re: /\b(?:it|test|describe)\.todo\b/, why: "禁 todo：占位不算用例（plan/04 §1.9.4-2/3）" },
  { name: "retry", re: /(?:^|[,{(\s])retry\s*:\s*\d/, why: "禁 retry 选项：重跑变绿=刷绿（plan/04 §1.9.4-3）" },
];

/** 主校验：返回 { errors, notes, stats }（无副作用，便于测试面复用）。 */
export function checkManifest(root) {
  const errors = [];
  const notes = [];
  const stats = { includes: 0, testFiles: 0, suiteFiles: 0, cases: 0, markers: 0 };

  // ① + ⑤ 配置面
  const configPath = path.join(root, CONFIG_FILE);
  if (!fs.existsSync(configPath)) {
    errors.push(`缺 ${CONFIG_FILE}（V2 新套件配置未落位）`);
  } else {
    const src = maskComments(fs.readFileSync(configPath, "utf8"));
    const include = readStringArray(src, "include");
    if (include === null || include.length === 0) {
      errors.push(`${CONFIG_FILE} 读不到非空 include 数组（清单口径不可判）`);
    } else {
      stats.includes = include.length;
      for (const glob of include) {
        if (!ALLOWED_INCLUDE.test(glob)) {
          errors.push(`include 非法 glob：${glob}（只准 apps|packages/*/test/v2/**/*.test.ts；旧测试路径禁入）`);
        }
      }
      if (!include.some((g) => g.includes("test/v2/"))) {
        errors.push(`include 无任何 test/v2 glob（V2 套件无从收集）`);
      }
      const dup = include.filter((g, i) => include.indexOf(g) !== i);
      if (dup.length > 0) errors.push(`include 有重复 glob：${dup.join(", ")}`);
    }
    const retryMatch = /\bretry\s*:\s*(\d+)/.exec(src);
    if (retryMatch === null) {
      errors.push(`${CONFIG_FILE} 未显式声明 retry: 0（默认值不算声明，plan/04 §1.9.4-3）`);
    } else if (Number(retryMatch[1]) !== 0) {
      errors.push(`${CONFIG_FILE} retry=${retryMatch[1]}（必须 0：禁重跑刷绿）`);
    }
    if (/passWithNoTests/.test(src)) errors.push(`${CONFIG_FILE} 出现 passWithNoTests（空套必须红）`);
  }

  // ② test/v2 文件数与用例数
  const suiteFiles = v2SuiteFiles(root);
  const testFiles = suiteFiles.filter((f) => f.endsWith(".test.ts"));
  stats.suiteFiles = suiteFiles.length;
  stats.testFiles = testFiles.length;
  if (testFiles.length === 0) {
    errors.push(`test/v2 下 0 个 *.test.ts（空套=红；先落冒烟件，plan/04 §1.9.4-2）`);
  }

  // ③ 禁标记扫描（扫 test/v2 全部 .ts：setup/夹具里 skip 同样算）
  const caseRe = /\b(?:it|test)(?:\.\w+)?\s*\(/g;
  for (const rel of suiteFiles) {
    const text = fs.readFileSync(path.join(root, rel), "utf8");
    if (rel.endsWith(".test.ts")) stats.cases += (text.match(caseRe) ?? []).length;
    const code = maskComments(text);
    for (const rule of MARKER_RULES) {
      const m = rule.re.exec(code);
      if (m !== null) {
        stats.markers += 1;
        errors.push(`${rel} 命中禁标记 ${rule.name}（${JSON.stringify(m[0].trim())}）：${rule.why}`);
      }
    }
  }
  if (testFiles.length > 0 && stats.cases === 0) {
    errors.push(`test/v2 静态用例数 0（有文件无用例：空套=红）`);
  }

  // ④ 根 package.json 的 test:v2
  const pkgPath = path.join(root, PKG_FILE);
  if (!fs.existsSync(pkgPath)) {
    errors.push(`缺根 ${PKG_FILE}`);
  } else {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const script = pkg.scripts?.["test:v2"];
    if (typeof script !== "string" || script.trim() === "") {
      errors.push(`根 ${PKG_FILE} 缺 scripts["test:v2"]（V2 套件命令未串接）`);
    } else {
      if (!/\bvitest\b/.test(script)) errors.push(`test:v2 不是 vitest 命令：${script}`);
      if (!script.includes(CONFIG_FILE)) errors.push(`test:v2 未指向 ${CONFIG_FILE}：${script}`);
      if (/--passWithNoTests/.test(script)) errors.push(`test:v2 含 --passWithNoTests（空套必须红）`);
      if (/--retry\b/.test(script)) errors.push(`test:v2 含 --retry（禁重跑刷绿）`);
      notes.push(`test:v2 = ${script}`);
    }
    const typecheck = pkg.scripts?.["typecheck:v2"];
    if (typeof typecheck !== "string" || !typecheck.includes("tsconfig.v2.json")) {
      errors.push(`根 ${PKG_FILE} 的 typecheck:v2 未指向 tsconfig.v2.json（新套件类型门未串接）`);
    } else {
      notes.push(`typecheck:v2 = ${typecheck}`);
    }
    const verify = pkg.scripts?.["verify:v2"];
    const verifyNeeds = ["guard:boundaries", "typecheck", "typecheck:v2", "test:v2", "v2-suite-manifest.mjs", "old-test-ledger.mjs"];
    if (typeof verify !== "string") {
      errors.push(`根 ${PKG_FILE} 缺 scripts["verify:v2"]（V2 门禁链未串接）`);
    } else {
      const missing = verifyNeeds.filter((k) => !verify.includes(k));
      if (missing.length > 0) errors.push(`verify:v2 缺环节：${missing.join(", ")}`);
      if (verify.includes("passWithNoTests")) errors.push(`verify:v2 含 passWithNoTests`);
      notes.push(`verify:v2 = ${verify}`);
    }
  }

  return { errors, notes, stats };
}

function main() {
  const args = process.argv.slice(2);
  const rootFlag = args.indexOf("--root");
  const root = rootFlag >= 0 ? path.resolve(args[rootFlag + 1]) : path.resolve(import.meta.dirname, "..", "..");
  const { errors, notes, stats } = checkManifest(root);

  for (const n of notes) console.log(`[v2-suite-manifest] 注 ${n}`);
  if (errors.length > 0) {
    for (const e of errors) console.error(`[v2-suite-manifest] FAIL ${e}`);
    console.error(`v2-suite-manifest FAIL：${errors.length} 项（清单不成立即 V2 门不成立）`);
    return 1;
  }
  console.log(`[v2-suite-manifest] OK ① include ${stats.includes} 个 glob，全部只含 test/v2`);
  console.log(`[v2-suite-manifest] OK ② test/v2 测试文件 ${stats.testFiles} 件（test/v2 下 .ts 共 ${stats.suiteFiles} 件），静态用例 ${stats.cases} 条`);
  console.log(`[v2-suite-manifest] OK ③ 禁标记 skip/only/todo/retry 命中 ${stats.markers} 处`);
  console.log(`[v2-suite-manifest] OK ④ test:v2 无 --passWithNoTests / --retry，指向 ${CONFIG_FILE}`);
  console.log(`[v2-suite-manifest] OK ⑤ 配置 retry: 0`);
  console.log(`v2-suite-manifest PASS：V2 新套件清单自检 5/5（plan/04 §1.9.2/§1.9.4）`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
