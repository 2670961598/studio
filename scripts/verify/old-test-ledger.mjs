#!/usr/bin/env node
// old-test-ledger.mjs —— 旧测试台账机械校验（MIG-02 / IMPL-02-02）
//
// 依据：plan/04 §1.8.4（校验五条）／§1.8.3（八列格式）／§1.8.3-补（baseline 与 ledger 关系、
//       校验基准＝209 实测清单＋口径差 1 行）、plan/03 §三（MIG-02 出口第 4 条）、
//       plan/05 IMPL-02-02、docs/86 B5、docs/90 §三 R5（审计基线 37 vs 实测 20）。
//
// 校验七件事（任一不满足 → exit 1）：
//   ① 209 个 `.test.ts` 路径全覆盖（排除 `test/v2/**`）：与仓内实时 walk 结果**逐项相等**，
//      缺一件=无声删除、多一件=未登记新增，两个方向都判红；
//   ② 口径差 1 行在册且路径为 `scripts/guards/boundaries.test.mjs`（vitest 第 210 件）；
//   ③ 每行八列齐全：路径/状态/用例数/失败类/处置/责任波/理由/最近复跑；处置/责任波/理由无空；
//   ④ 13 个红文件行在册，且与主表红行**同集合、同用例数**；
//   ⑤ 20 条红用例逐条有「文件｜用例名｜失败类｜处置｜责任波｜理由」，且按文件计数与主表「败」列相等；
//   ⑥ 台账含「审计基线 37 / 实测 20」口径说明与数据源标注（不把 37 冒充实测、不把 20 说成 37）；
//   ⑦ 无 `test/v2` 路径混入、无「未登记」占位、无重复路径。
//
// 零依赖（node:fs/node:path）；Node 24 直跑。用法：
//   node scripts/verify/old-test-ledger.mjs [--root <仓根>]   # 违例 exit 1
//
// 边界：本脚本**不跑** vitest（不重跑旧套件，旧套件不作门）；只做台账与仓内实况的机械比对。

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const LEDGER = "docs/baselines/old-tests-ledger.md";
const DELTA_PATH = "scripts/guards/boundaries.test.mjs";
const EXPECT_FILES = 209;
const EXPECT_RED_FILES = 13;
const EXPECT_RED_CASES = 20;

/** 锚点：三块机械受检区（台账正文里的 HTML 注释；人读无关、机读定位）。 */
const ANCHORS = {
  files: ["<!-- ledger:files:start -->", "<!-- ledger:files:end -->"],
  delta: ["<!-- ledger:delta:start -->", "<!-- ledger:delta:end -->"],
  red: ["<!-- ledger:red:start -->", "<!-- ledger:red:end -->"],
};

const STATUS = new Set(["绿", "红", "未跑"]);
const DISPOSAL = new Set(["保留观察", "重写", "退役", "真缺陷"]);
const FAIL_CLASS = new Set(["timeout", "断言", "TS", "环境", "其他", "栈错误", "—"]);
const RED_CASE_CLASS = new Set(["timeout", "断言", "环境", "栈错误"]);
const WAVE_RE = /^(?:MIG-0[1-8]|V2 后存废门)/;

/** 取锚点之间的文本；缺锚点返回 null。 */
export function section(text, name) {
  const [open, close] = ANCHORS[name] ?? [null, null];
  if (open === null) return null;
  const a = text.indexOf(open);
  const b = text.indexOf(close);
  if (a < 0 || b < 0 || b < a) return null;
  return text.slice(a + open.length, b);
}

/** 解析一段文本里的全部 GFM 表：返回 [{ header, rows }]（rows 为单元格数组）。 */
export function parseTables(text) {
  const tables = [];
  let block = [];
  const flush = () => {
    if (block.length >= 2) {
      const cells = block.map(splitRow);
      const header = cells[0];
      const rows = cells.slice(2); // 第 1 行表头，第 2 行分隔线
      tables.push({ header, rows });
    }
    block = [];
  };
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("|")) block.push(line.trim());
    else flush();
  }
  flush();
  return tables;
}

function splitRow(line) {
  const t = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return t.split("|").map((c) => c.trim());
}

/** 取单元格里的路径（去反引号与两端空白）。 */
const asPath = (c) => c.replace(/`/g, "").trim();

/** 仓内实时旧测试清单：apps|packages 下全部 *.test.ts，剔除 test/v2（排除 node_modules/.git）。 */
export function collectOldTestFiles(root) {
  const out = [];
  const walk = (dir) => {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (e.isFile() && e.name.endsWith(".test.ts")) out.push(rel);
    }
  };
  for (const kind of ["apps", "packages"]) {
    const abs = path.join(root, kind);
    if (!fs.existsSync(abs)) continue;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${kind}/${e.name}`);
    }
  }
  return out.filter((f) => !f.includes("/test/v2/")).sort();
}

/** 主校验：返回 { errors, notes, stats }（无副作用）。 */
export function checkLedger(root) {
  const errors = [];
  const notes = [];
  const stats = { files: 0, green: 0, red: 0, redFiles: 0, delta: 0, redCaseRows: 0, onDisk: 0 };
  const ledgerPath = path.join(root, LEDGER);
  if (!fs.existsSync(ledgerPath)) {
    return { errors: [`缺台账件 ${LEDGER}（MIG-02 产物未落位）`], notes, stats };
  }
  const text = fs.readFileSync(ledgerPath, "utf8");

  // ⑥ 口径说明与数据源标注
  const fact = (needle, why) => {
    if (!text.includes(needle)) errors.push(`台账缺「${needle}」（${why}）`);
  };
  fact("审计基线 37", "必须保留审计基线 37 的历史说明（不许删除历史基线）");
  fact("实测 20", "必须写明实测 20 failed（不许把 37 写成实测值，也不许把 20 说成 37）");
  fact("13 failed files", "必须写明实测 13 failed files");
  fact("210 files", "必须写明 vitest 口径 210 files（209 .test.ts ＋ 口径差 1）");
  fact("2976", "必须写明 2976 tests");
  fact("/tmp/studio-next-vitest.json", "必须标注数据源 JSON 路径");
  fact("16:28", "必须标注数据源时间 2026-10-28 16:28");
  fact("非门", "必须写明旧测试不作施工门");

  // ① 209 行
  const filesSec = section(text, "files");
  if (filesSec === null) {
    errors.push("缺锚点 ledger:files（209 行主表不可判）");
  } else {
    const rows = parseTables(filesSec).flatMap((t) => t.rows.map((r) => ({ cols: r.length, cells: r })));
    const eight = rows.filter((r) => r.cols === 8).map((r) => r.cells);
    stats.files = eight.length;
    if (eight.length !== EXPECT_FILES) {
      errors.push(`主表行数 ${eight.length} ≠ ${EXPECT_FILES}（少=无声删除；多=未登记新增；口径差行须放 ledger:delta 区）`);
    }
    const paths = eight.map((c) => asPath(c[0]));
    const onDisk = collectOldTestFiles(root);
    stats.onDisk = onDisk.length;
    for (const p of paths) {
      if (p.includes("/test/v2/") || p.startsWith("test/v2/")) errors.push(`主表混入 V2 新套件路径：${p}`);
      if (!p.endsWith(".test.ts")) errors.push(`主表路径不是 *.test.ts：${p}`);
    }
    const dup = paths.filter((p, i) => paths.indexOf(p) !== i);
    if (dup.length > 0) errors.push(`主表路径重复：${[...new Set(dup)].join(", ")}`);
    const missing = onDisk.filter((p) => !paths.includes(p));
    const extra = paths.filter((p) => !onDisk.includes(p));
    if (missing.length > 0) {
      errors.push(`台账缺 ${missing.length} 件（无声删除=事故）：${missing.slice(0, 5).join(", ")}${missing.length > 5 ? " …" : ""}`);
    }
    if (extra.length > 0) {
      errors.push(`台账多 ${extra.length} 件（仓内无此文件=伪造或已删未改处置）：${extra.slice(0, 5).join(", ")}${extra.length > 5 ? " …" : ""}`);
    }
    // ③ 八列校验
    for (const c of eight) {
      validateFileRow(c, errors);
      if (c[1] === "绿") stats.green += 1;
      if (c[1] === "红") stats.red += 1;
    }
  }

  // ② 口径差 1 行
  const deltaSec = section(text, "delta");
  if (deltaSec === null) {
    errors.push("缺锚点 ledger:delta（口径差 1 行不可判）");
  } else {
    const rows = parseTables(deltaSec).flatMap((t) => t.rows.filter((r) => r.length === 8));
    stats.delta = rows.length;
    if (rows.length !== 1) {
      errors.push(`口径差行数 ${rows.length} ≠ 1（vitest 210 的第 210 件须单列 1 行）`);
    } else {
      const c = rows[0];
      if (asPath(c[0]) !== DELTA_PATH) errors.push(`口径差行路径应为 ${DELTA_PATH}，实为 ${asPath(c[0])}`);
      validateFileRow(c, errors);
    }
    if (!fs.existsSync(path.join(root, DELTA_PATH))) errors.push(`口径差件在仓内不存在：${DELTA_PATH}`);
  }

  // ④⑤ 红文件行与红用例
  const redSec = section(text, "red");
  if (redSec === null) {
    errors.push("缺锚点 ledger:red（13 红文件行／20 红用例不可判）");
  } else {
    const tables = parseTables(redSec);
    const fileRows = tables.flatMap((t) => t.rows.filter((r) => r.length === 8));
    const caseRows = tables.flatMap((t) => t.rows.filter((r) => r.length === 6));
    stats.redFiles = fileRows.length;
    stats.redCaseRows = caseRows.length;
    if (fileRows.length !== EXPECT_RED_FILES) {
      errors.push(`红文件行 ${fileRows.length} ≠ ${EXPECT_RED_FILES}`);
    }
    if (caseRows.length !== EXPECT_RED_CASES) {
      errors.push(`红用例行 ${caseRows.length} ≠ ${EXPECT_RED_CASES}（20 条 failed 须逐条有归属）`);
    }
    const redPaths = fileRows.map((c) => asPath(c[0]));
    const caseFiles = new Set(caseRows.map((c) => asPath(c[0])));
    for (const p of caseFiles) {
      if (!redPaths.includes(p)) errors.push(`红用例挂了非红文件：${p}（该文件未在红文件行登记）`);
    }
    // 红用例六列
    for (const c of caseRows) {
      const [file, name, cls, disposal, wave, why] = c;
      if (asPath(file).trim() === "") errors.push("红用例行缺「文件」列");
      if (name.trim() === "") errors.push(`红用例行缺「用例名」：${file}`);
      if (!RED_CASE_CLASS.has(cls)) errors.push(`红用例失败类非法「${cls}」（应 ∈ timeout/断言/环境/栈错误）：${file}｜${name}`);
      if (!DISPOSAL.has(disposal)) errors.push(`红用例处置非法「${disposal}」：${file}｜${name}`);
      if (!WAVE_RE.test(wave)) errors.push(`红用例责任波非法「${wave}」：${file}｜${name}`);
      if (why.trim().length < 4) errors.push(`红用例理由为空/过短：${file}｜${name}`);
      if (!why.includes("非门")) errors.push(`红用例理由未写明「非门」：${file}｜${name}`);
    }
    // 红文件行与主表一致性 + 「败」列与红用例数一致
    const filesSec2 = section(text, "files");
    const mainRows = filesSec2 === null ? [] : parseTables(filesSec2).flatMap((t) => t.rows.filter((r) => r.length === 8));
    const mainRed = mainRows.filter((c) => c[1] === "红").map((c) => asPath(c[0]));
    if (mainRed.length !== EXPECT_RED_FILES) errors.push(`主表红行 ${mainRed.length} ≠ ${EXPECT_RED_FILES}`);
    const setDiff = (a, b) => a.filter((x) => !b.includes(x));
    const onlyMain = setDiff(mainRed, redPaths);
    const onlyRed = setDiff(redPaths, mainRed);
    if (onlyMain.length > 0) errors.push(`主表红行未在 §四登记：${onlyMain.join(", ")}`);
    if (onlyRed.length > 0) errors.push(`§四红文件在主板非红：${onlyRed.join(", ")}`);
    for (const c of fileRows) {
      const p = asPath(c[0]);
      const main = mainRows.find((m) => asPath(m[0]) === p);
      if (main === undefined) {
        errors.push(`红文件行不在主表：${p}`);
        continue;
      }
      if (main[2] !== c[2]) errors.push(`红文件用例数与主表不一致：${p}（§四 ${c[2]} vs 主表 ${main[2]}）`);
      const n = caseRows.filter((x) => asPath(x[0]) === p).length;
      const failed = Number((c[2].split("/")[1] ?? "NaN").trim());
      if (!Number.isInteger(failed)) errors.push(`红文件用例数「${c[2]}」不可解析为 过/败：${p}`);
      else if (n !== failed) errors.push(`红用例条数 ${n} ≠ 「败」列 ${failed}：${p}`);
    }
    const sumFailed = fileRows.reduce((s, c) => s + Number((c[2].split("/")[1] ?? "0").trim() || 0), 0);
    if (sumFailed !== EXPECT_RED_CASES) errors.push(`红文件「败」列合计 ${sumFailed} ≠ ${EXPECT_RED_CASES}`);
  }

  // ⑦ 占位与污染
  if (text.includes("未登记")) errors.push("台账出现「未登记」占位（每行必须已登记）");
  if (/test\/v2\/[^\s`）)]*\.test\.ts/.test(text)) {
    const hit = text.match(/test\/v2\/[^\s`）)]*\.test\.ts/g) ?? [];
    errors.push(`台账表格出现 test/v2 路径：${[...new Set(hit)].join(", ")}`);
  }

  notes.push(`仓内旧测试件 ${stats.onDisk} 件（剔除 test/v2），台账主表 ${stats.files} 行：绿 ${stats.green} / 红 ${stats.red}`);
  return { errors, notes, stats };
}

/** 八列文件行的逐列校验（主表与口径差行共用）。 */
function validateFileRow(c, errors) {
  if (c.length !== 8) {
    errors.push(`行不是 8 列（${c.length}）：${c.join(" | ")}`);
    return;
  }
  const [pathCell, status, counts, failClass, disposal, wave, reason, rerun] = c;
  const p = asPath(pathCell);
  if (!STATUS.has(status)) errors.push(`状态非法「${status}」（应 ∈ 绿/红/未跑）：${p}`);
  if (!/^(?:\d+\/\d+|n\/a)$/.test(counts)) errors.push(`用例数非法「${counts}」（应 过/败 或 n/a）：${p}`);
  if (!FAIL_CLASS.has(failClass)) errors.push(`失败类非法「${failClass}」（应 ∈ timeout/断言/TS/环境/其他/栈错误/—）：${p}`);
  if (status === "绿" && failClass !== "—") errors.push(`绿行失败类应为「—」，实为「${failClass}」：${p}`);
  if (status === "红" && (failClass === "—" || failClass === "其他")) errors.push(`红行失败类必须具体（timeout/断言/环境/栈错误），实为「${failClass}」：${p}`);
  if (!DISPOSAL.has(disposal)) errors.push(`处置非法「${disposal}」（应 ∈ 保留观察/重写/退役/真缺陷）：${p}`);
  if (disposal === "重写" || disposal === "退役") {
    if (!/单号|删除单|替代/.test(reason)) errors.push(`「${disposal}」行理由须写替代覆盖与删除单：${p}`);
  }
  if (!WAVE_RE.test(wave)) errors.push(`责任波非法「${wave}」（应 MIG-01..08 或 V2 后存废门）：${p}`);
  if (reason.trim().length < 4) errors.push(`理由为空/过短：${p}`);
  if (!reason.includes("非门")) errors.push(`理由未写明「非门」：${p}`);
  if (!/2026-|日期|全量/.test(rerun)) errors.push(`最近复跑缺日期/命令/结果：${p}（实为「${rerun}」）`);
}

function main() {
  const args = process.argv.slice(2);
  const rootFlag = args.indexOf("--root");
  const root = rootFlag >= 0 ? path.resolve(args[rootFlag + 1]) : path.resolve(import.meta.dirname, "..", "..");
  const { errors, notes, stats } = checkLedger(root);

  for (const n of notes) console.log(`[old-test-ledger] 注 ${n}`);
  if (errors.length > 0) {
    for (const e of errors) console.error(`[old-test-ledger] FAIL ${e}`);
    console.error(`old-test-ledger FAIL：${errors.length} 项（台账不成立即 V2 门缺一条腿）`);
    return 1;
  }
  console.log(`[old-test-ledger] OK ① 209 .test.ts 全覆盖：与仓内 walk 逐项相等（${stats.onDisk} 件，0 缺 0 多）`);
  console.log(`[old-test-ledger] OK ② 口径差 1 行：${DELTA_PATH}`);
  console.log(`[old-test-ledger] OK ③ 八列齐全、处置/责任波/理由无空、理由均写「观察位/非门」`);
  console.log(`[old-test-ledger] OK ④ 红文件 ${stats.red} 个（§四登记 ${stats.redFiles} 个），绿 ${stats.green} 个（合计 ${stats.files}）`);
  console.log(`[old-test-ledger] OK ⑤ 红用例 ${stats.redCaseRows} 条逐条有归属，且逐文件与「败」列相等`);
  console.log(`[old-test-ledger] OK ⑥ 含「审计基线 37 / 实测 20」口径说明与数据源标注（不冒充、不互否）`);
  console.log(`[old-test-ledger] OK ⑦ 无 test/v2 路径混入、无重复、无「未登记」占位`);
  console.log(`old-test-ledger PASS：旧测试台账自检 7/7（plan/04 §1.8.4）`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
