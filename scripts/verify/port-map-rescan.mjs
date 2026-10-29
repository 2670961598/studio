#!/usr/bin/env node
// port-map-rescan.mjs —— F5 端口-文件映射机械复扫（MIG-08 / IMPL-08-03）
//
// 依据：plan/05 IMPL-08-03（14 §二单点表→代码文件机械比对）、plan/03 §九（MIG-08
//       出口门禁：本脚本「本波落位后生效」，`node scripts/verify/port-map-rescan.mjs`
//       exit 0）、docs/v2/14 §二（端口-文件映射单点表＝F5 唯一源；目录预算「终态 20 件
//       ≤ 25」）、docs/v2/17 §三 PORT- 行/§七 F5 行、docs/v2/17 §4.5 GAP-V2-15
//       （F5 机械复扫腿）、docs/v2/00 冻结门 F5「端口-文件映射单点」、
//       docs/v2/16 B4（目录尺寸阈 25）、plan/05 IMPL-06-09（ports 终态 20 件验收）。
//
// 六项机械比对（任一不满足 → exit 1；差异逐条打印，stdout=OK，stderr=FAIL）：
//   ① 单点表结构：恰好 13 行；PORT-ID 唯一；落点文件唯一（一文件一端口）；落点平铺
//      `<file>.ts`（无目录分隔、无占位符）——「映射单点零冲突」的表述面。
//   ② 落点实存：13/13 映射文件在 packages/contract/src/ports/ 实存——「无缺失」。
//   ③ 落点自证：每个映射文件声明 `PORT_<X> = 'PORT-X'` 常量（表与文件互指；防换绑、
//      防空壳件）；承载件（非映射件）不得声明任何 `PORT-` 值常量（端口形状双源）。
//   ④ 目录实况：磁盘件集合 = 映射 13 件 ∪ 承载件（现状 9 件 − 退役 2 件）= 20 件；
//      0 多余、0 缺失、无子目录、≤ guard 阈 25——「无多余」＋预算。
//   ⑤ 口径声明：v2/14 头注/§一、v2/17 §三/F5 行、v2/05 修订记录的端口计数均 = 表行数；
//      v2/17 §三 PORT- 行的 ID 名单与表集合逐项相等（13/14 计数分歧的机械腿）。
//   ⑥ 他卷零冲突：docs/v2 其余卷零端口路径（`ports/<file>.ts`）、零「PORT- ＋ 落点
//      文件名」同句声明；源卷 §二 之外同样为 0（单点表＝唯一映射源）。
//
// 零依赖（node:fs/node:path/node:url；阈 25 从 scripts/guards/boundary-rules.mjs 单源取）。
// Node 24 直跑。用法：
//   node scripts/verify/port-map-rescan.mjs [--root <仓根>] [--doc <映射源>] [--ports <ports 目录>]
//   --root   仓根（默认=本脚本上两级）；--doc 覆盖映射源卷（负向伴测用临时副本）；
//   --ports  覆盖落点目录（默认 <root>/packages/contract/src/ports）。
//
// 边界：本脚本**只读**（不写任何文件、不跑 vitest、不碰源件）；负向验证在伴测
//   packages/contract/test/v2/port-map-rescan.test.ts（临时副本改一行映射 → exit 1，
//   真实文件前后逐字不变）。脚本只做映射表↔磁盘↔声明面的机械比对，不做端口语义裁决。

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { maxFilesPerDirectory } from "../guards/boundary-rules.mjs";

// ── 冻结口径（plan/05 IMPL-08-03：13 端口单点表 / 终态 20 文件）────────────────
// 13＝v2/14 §二表行数（v2/17 §三「PORT- 运行时端口（13）」）；20＝v2/14 §二「终态 20 件
// ≤ 25」（plan/05 IMPL-06-09 验收「ports 终态 20 件≤25」）。两数冻结，表/盘任一漂移即红。
const FROZEN_PORT_COUNT = 13;
const FROZEN_FILE_COUNT = 20;
const SOURCE_VOLUME = "14";
const PORTS_REL = "packages/contract/src/ports";

// ── 小工具 ───────────────────────────────────────────────────────────────────

function readText(file) {
  return fs.readFileSync(file, "utf8");
}

/** GFM 行 → 单元格数组（去首尾竖线；不做转义还原——本表无转义竖线）。 */
function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

/** 在 docs/v2 下唯一定位 `<num>-*.md` 卷；缺失或不唯一返回 null。 */
function findVolumeFile(docsDir, num) {
  if (!fs.existsSync(docsDir)) return null;
  const names = fs
    .readdirSync(docsDir)
    .filter((n) => new RegExp(`^${num}-.*\\.md$`).test(n))
    .sort();
  if (names.length !== 1) return null;
  return path.join(docsDir, names[0]);
}

/** 取 `## ` 章节区间（行号 0-based，end 不含）；缺标题返回 null。 */
function findSection(lines, headingRe) {
  const start = lines.findIndex((l) => headingRe.test(l));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start, end };
}

/** 取章节内第一个数；读不到返回 null（调用方记缺锚）。 */
function budgetNumber(sectionText, re) {
  const m = re.exec(sectionText);
  return m === null ? null : Number(m[1]);
}

/** 取括号名单（`现状 9 件（a/b/c）` 的括号内；统一补 `.ts` 后与磁盘件名可比）。 */
function budgetNames(sectionText, re) {
  const m = re.exec(sectionText);
  if (m === null) return null;
  return m[1]
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => (/\.(?:ts|mts|cts)$/.test(s) ? s : `${s}.ts`));
}

// ── §二 解析：映射表 + 目录预算句 ────────────────────────────────────────────

/**
 * 解析 v2/14 §二。
 * 返回 { rows:[{id,file,docLine,rawFileCell}], budget:{...}, section:{start,end}, errors }。
 * `section` 是行号区间（0-based，end 不含），供第⑥项扫描「§二之外」用。
 */
export function parseMapping(docText) {
  const errors = [];
  const lines = docText.split("\n");
  const section = findSection(lines, /^##\s+二、[^\n]*端口-文件映射/);
  if (section === null) {
    return {
      rows: [],
      budget: emptyBudget(),
      section: null,
      errors: ["映射源缺锚：读不到 §二「端口-文件映射单点表」章节标题"],
    };
  }
  const body = lines.slice(section.start, section.end);

  // 表头定位：`| PORT-ID | ... |`（表体紧接其后，遇非表行即止）
  const headerIdx = body.findIndex((l) => /^\|\s*PORT-ID\s*\|/.test(l));
  if (headerIdx < 0) {
    return {
      rows: [],
      budget: emptyBudget(),
      section,
      errors: ["映射源缺锚：§二 读不到映射表头「| PORT-ID | ... |」"],
    };
  }
  const header = splitRow(body[headerIdx]);
  const idCol = header.findIndex((c) => c === "PORT-ID");
  const fileCol = header.findIndex((c) => c.includes("类型唯一落点"));
  if (idCol < 0 || fileCol < 0) {
    return {
      rows: [],
      budget: emptyBudget(),
      section,
      errors: [
        `映射源缺锚：§二 表头缺列（PORT-ID=${idCol}，类型唯一落点=${fileCol}；表列改名须同步本脚本＝提案流）`,
      ],
    };
  }

  const rows = [];
  for (let i = headerIdx + 1; i < body.length; i++) {
    const line = body[i];
    if (!line.trim().startsWith("|")) break;
    const cells = splitRow(line);
    if (isSeparatorRow(cells)) continue;
    const docLine = section.start + i + 1;
    const rawFileCell = cells[fileCol] ?? "";
    const tokens = [...rawFileCell.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());
    let file = null;
    if (tokens.length === 1) file = tokens[0];
    else if (tokens.length === 0 && /^[A-Za-z0-9_-]+\.ts$/.test(rawFileCell.trim())) file = rawFileCell.trim();
    rows.push({ id: (cells[idCol] ?? "").trim(), file, docLine, rawFileCell });
  }

  // 目录预算句（§二 末尾）：现状 N 件（...）；新增 N；改造承载 N；退役 N（...）；终态 N；阈 N
  const sectionText = body.join("\n");
  const budget = {
    legacyCount: budgetNumber(sectionText, /现状\s*(\d+)\s*件（[^）]+）/),
    legacyNames: budgetNames(sectionText, /现状\s*\d+\s*件（([^）]+)）/),
    addedCount: budgetNumber(sectionText, /本表新增\s*(\d+)\s*件/),
    rebuiltCount: budgetNumber(sectionText, /改造承载\s*(\d+)\s*件/),
    retiredCount: budgetNumber(sectionText, /并入退役\s*(\d+)\s*件（[^）]+）/),
    retiredNames: budgetNames(sectionText, /并入退役\s*\d+\s*件（([^）]+)）/),
    terminalCount: budgetNumber(sectionText, /终态\s*\*{0,2}\s*(\d+)\s*件/),
    thresholdCount: budgetNumber(sectionText, /阈\s*=\s*(\d+)/),
  };
  const anchors = [
    ["「现状 N 件（...）」", budget.legacyCount !== null && budget.legacyNames !== null],
    ["「本表新增 N 件」", budget.addedCount !== null],
    ["「改造承载 N 件」", budget.rebuiltCount !== null],
    ["「并入退役 N 件（...）」", budget.retiredCount !== null && budget.retiredNames !== null],
    ["「终态 N 件」", budget.terminalCount !== null],
    ["「阈=N」", budget.thresholdCount !== null],
  ];
  for (const [label, ok] of anchors) {
    if (!ok) errors.push(`映射源缺锚：§二 目录预算句读不到${label}（机械比对缺口径）`);
  }
  return { rows, budget, section, errors };
}

function emptyBudget() {
  return {
    legacyCount: null,
    legacyNames: null,
    addedCount: null,
    rebuiltCount: null,
    retiredCount: null,
    retiredNames: null,
    terminalCount: null,
    thresholdCount: null,
  };
}

// ── 主校验（无副作用；返回 errors/notes/stats，便于复算与测试面消费）─────────

/**
 * @param {string} root 仓根
 * @param {{doc?: string, ports?: string}} [options]
 * @returns {{errors: string[], notes: string[], stats: Record<string, number | string>}}
 */
export function checkPortMap(root, options = {}) {
  const errors = [];
  const notes = [];
  const stats = {
    rows: 0,
    mappedFiles: 0,
    onDiskFiles: 0,
    supportFiles: 0,
    missing: 0,
    extra: 0,
    conflicts: 0,
    declarations: 0,
    scannedVolumes: 0,
    idLists: 0,
    sourceDoc: "",
  };

  const docsDir = path.join(root, "docs", "v2");
  const portsDir = options.ports === undefined ? path.join(root, PORTS_REL) : path.resolve(root, options.ports);
  const docPath =
    options.doc === undefined ? findVolumeFile(docsDir, SOURCE_VOLUME) : path.resolve(root, options.doc);

  if (docPath === null || !fs.existsSync(docPath)) {
    errors.push(
      options.doc === undefined
        ? `映射源卷 docs/v2/${SOURCE_VOLUME}-*.md 缺失或不唯一（无法复扫）`
        : `--doc 指定的映射源不存在：${String(options.doc)}`,
    );
    return { errors, notes, stats };
  }
  if (!fs.existsSync(portsDir)) {
    errors.push(`落点目录不存在：${path.relative(root, portsDir) || portsDir}`);
    return { errors, notes, stats };
  }

  stats.sourceDoc = path.relative(root, docPath);
  const docText = readText(docPath);
  const parsed = parseMapping(docText);
  errors.push(...parsed.errors);
  const { rows, budget, section } = parsed;
  stats.rows = rows.length;

  // ① 单点表结构：一行一端口、一文件一端口、平铺 .ts
  const idToFile = new Map();
  const fileToId = new Map();
  for (const row of rows) {
    if (!/^PORT-[A-Z]+$/.test(row.id)) {
      stats.conflicts += 1;
      errors.push(`冲突：§二:${row.docLine} PORT-ID「${row.id || "(空)"}」不是 PORT-<大写> 形式`);
      continue;
    }
    if (row.file === null) {
      stats.conflicts += 1;
      errors.push(`冲突：§二:${row.docLine} ${row.id} 落点列读不到唯一 .ts（原文 ${JSON.stringify(row.rawFileCell)}）`);
      continue;
    }
    if (!/^[A-Za-z0-9_-]+\.ts$/.test(row.file)) {
      stats.conflicts += 1;
      errors.push(`冲突：§二:${row.docLine} ${row.id} 落点「${row.file}」不是平铺 <file>.ts（ports/ 直属单件）`);
      continue;
    }
    if (idToFile.has(row.id)) {
      stats.conflicts += 1;
      errors.push(`冲突：${row.id} 在单点表出现两次（${idToFile.get(row.id)} / ${row.file}；一行一端口）`);
    } else {
      idToFile.set(row.id, row.file);
    }
    if (fileToId.has(row.file)) {
      stats.conflicts += 1;
      errors.push(`冲突：${row.file} 被 ${fileToId.get(row.file)} 与 ${row.id} 同时指认（一文件一端口）`);
    } else {
      fileToId.set(row.file, row.id);
    }
  }
  stats.mappedFiles = fileToId.size;
  const mappedFiles = [...fileToId.keys()].sort();
  if (rows.length !== FROZEN_PORT_COUNT) {
    errors.push(`口径冲突：单点表 ${rows.length} 行 ≠ 冻结 ${FROZEN_PORT_COUNT} 端口（v2/14 §二/F5）`);
  }

  // 磁盘实况（只算 ports/ 直属项；子目录=预算外）
  const entries = fs.readdirSync(portsDir, { withFileTypes: true });
  const subdirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  for (const d of subdirs) {
    errors.push(`多余：${PORTS_REL}/${d}/ 为子目录（单点表是平铺 20 件；子目录化须走提案流）`);
  }
  const onDisk = entries.filter((e) => e.isFile()).map((e) => e.name).sort();
  stats.onDiskFiles = onDisk.length;

  // ② 落点实存（缺失方向）
  for (const file of mappedFiles) {
    if (!onDisk.includes(file)) {
      stats.missing += 1;
      errors.push(`缺失：${PORTS_REL}/${file}（${fileToId.get(file)} 映射落点，磁盘不存在）`);
    }
  }

  // ③ 落点自证：映射件必须自报 PORT-<ID>；承载件不得声明 PORT- 值常量（双源）
  const declRe = /export\s+const\s+(PORT_[A-Z0-9_]+)\s*=\s*(['"])(PORT-[A-Z0-9-]+)\2/g;
  for (const file of mappedFiles) {
    if (!onDisk.includes(file)) continue;
    const src = readText(path.join(portsDir, file));
    const hit = [...src.matchAll(declRe)].find((m) => m[3] === fileToId.get(file));
    if (hit === undefined) {
      errors.push(
        `冲突：${PORTS_REL}/${file} 未声明 ${fileToId.get(file)} 常量（落点自证断裂＝表与文件不同指）`,
      );
    }
  }
  const mappedSet = new Set(mappedFiles);
  for (const file of onDisk) {
    if (mappedSet.has(file) || !file.endsWith(".ts")) continue;
    const src = readText(path.join(portsDir, file));
    const dup = [...src.matchAll(declRe)].find((m) => m[3] !== undefined);
    if (dup !== undefined) {
      stats.conflicts += 1;
      errors.push(`冲突：${PORTS_REL}/${file} 声明 ${dup[3]} 常量但不在映射表（端口形状双源／表外孤儿件）`);
    }
  }

  // ④ 目录实况：映射 ∪ 承载（现状 9 − 退役 2）＝ 20；0 多余 / 0 缺失 / ≤25
  const legacyNames = budget.legacyNames ?? [];
  const retiredNames = budget.retiredNames ?? [];
  for (const name of retiredNames) {
    if (!legacyNames.includes(name)) {
      errors.push(`口径冲突：退役件 ${name} 不在「现状 N 件」名单（预算句自相矛盾）`);
    }
  }
  const supportFiles = legacyNames.filter((n) => !retiredNames.includes(n));
  stats.supportFiles = supportFiles.length;
  const expected = new Set([...mappedFiles, ...supportFiles]);
  for (const file of supportFiles) {
    if (!onDisk.includes(file)) {
      stats.missing += 1;
      errors.push(`缺失：${PORTS_REL}/${file}（承载件：现状 ${legacyNames.length} − 退役 ${retiredNames.length}）`);
    }
  }
  for (const file of onDisk) {
    if (!expected.has(file)) {
      stats.extra += 1;
      errors.push(`多余：${PORTS_REL}/${file}（既非映射落点亦非承载名单 ${supportFiles.join("/") || "(空)"}）`);
    }
  }
  if (onDisk.length !== FROZEN_FILE_COUNT) {
    errors.push(`缺失/多余：${PORTS_REL} 实况 ${onDisk.length} 件 ≠ 终态 ${FROZEN_FILE_COUNT}（v2/14 §二；plan/05 IMPL-06-09）`);
  }
  if (expected.size !== FROZEN_FILE_COUNT) {
    errors.push(
      `口径冲突：映射 ${mappedFiles.length} ＋ 承载 ${supportFiles.length} = ${expected.size} ≠ 终态 ${FROZEN_FILE_COUNT}`,
    );
  }
  if (budget.legacyCount !== null && budget.legacyCount !== legacyNames.length) {
    errors.push(`口径冲突：预算句「现状 ${budget.legacyCount} 件」与实际名单 ${legacyNames.length} 件不符`);
  }
  if (budget.retiredCount !== null && budget.retiredCount !== retiredNames.length) {
    errors.push(`口径冲突：预算句「并入退役 ${budget.retiredCount} 件」与实际名单 ${retiredNames.length} 件不符`);
  }
  if (budget.addedCount !== null && budget.rebuiltCount !== null && budget.addedCount + budget.rebuiltCount !== rows.length) {
    errors.push(
      `口径冲突：预算句「新增 ${budget.addedCount} ＋ 改造承载 ${budget.rebuiltCount}」=${budget.addedCount + budget.rebuiltCount} ≠ 表行 ${rows.length}`,
    );
  }
  if (budget.terminalCount !== null && budget.terminalCount !== FROZEN_FILE_COUNT) {
    errors.push(`口径冲突：预算句「终态 ${budget.terminalCount} 件」≠ 冻结 ${FROZEN_FILE_COUNT}（v2/14 §二）`);
  }
  if (budget.thresholdCount !== null && budget.thresholdCount !== maxFilesPerDirectory) {
    errors.push(
      `口径冲突：§二「阈=${budget.thresholdCount}」≠ guard boundary-rules maxFilesPerDirectory=${maxFilesPerDirectory}（同阈双源）`,
    );
  }
  if (onDisk.length > maxFilesPerDirectory) {
    errors.push(`多余：${PORTS_REL} ${onDisk.length} 件 > 预算阈 ${maxFilesPerDirectory}（B4/v2/16）`);
  }
  if (legacyNames.length - retiredNames.length + mappedFiles.length !== FROZEN_FILE_COUNT) {
    errors.push(
      `口径冲突：现状 ${legacyNames.length} − 退役 ${retiredNames.length} ＋ 映射 ${mappedFiles.length} ≠ 终态 ${FROZEN_FILE_COUNT}`,
    );
  }

  // ⑤ 口径声明：各卷端口计数均＝表行数；v2/17 §三 PORT- 名单与表集合逐项相等
  const declProbes = [
    { label: `${path.basename(docPath)} 头注「端口计数不变＝N」`, text: docText, re: /端口计数不变[＝=]\s*(\d+)/g },
    { label: `${path.basename(docPath)} §一「（PORT- N」`, text: docText, re: /运行时端口接口（PORT-\s*(\d+)/g },
  ];
  const v05 = findVolumeFile(docsDir, "05");
  if (v05 !== null) {
    declProbes.push({
      label: `docs/v2/${path.basename(v05)} 修订记录「维持 N 端口」`,
      text: readText(v05),
      re: /维持\s*\*{0,2}\s*(\d+)\s*端口/g,
    });
  }
  const v17 = findVolumeFile(docsDir, "17");
  if (v17 !== null) {
    const v17Text = readText(v17);
    declProbes.push(
      { label: `docs/v2/${path.basename(v17)} §三「PORT- 运行时端口（N）」`, text: v17Text, re: /PORT-\s*运行时端口（(\d+)）/g },
      { label: `docs/v2/${path.basename(v17)} F5 行「映射单点（N）」`, text: v17Text, re: /F5\s+端口-文件映射单点（(\d+)）/g },
    );
    const tableIds = [...idToFile.keys()];
    for (const [i, line] of v17Text.split("\n").entries()) {
      const declared = /PORT-\s*运行时端口（(\d+)）/.exec(line);
      if (declared === null) continue;
      // 名单形态：`（PORT-AUTH/DEF/EVD/...）`（首项带前缀、余项简写）；逐项还原 PORT- 前缀。
      const listed = /PORT-([A-Z0-9]+(?:\/[A-Z0-9-]+)+)）/.exec(line);
      if (listed === null) {
        notes.push(`docs/v2/${path.basename(v17)}:${i + 1} PORT- 行读不到 ID 名单（跳过名单比对；不阻塞）`);
        continue;
      }
      const tokens = [...new Set(listed[1].split("/").map((s) => `PORT-${s.replace(/^PORT-/, "")}`))];
      stats.idLists += 1;
      const missingIds = tableIds.filter((id) => !tokens.includes(id));
      const extraIds = tokens.filter((id) => !tableIds.includes(id));
      if (Number(declared[1]) !== tableIds.length || tokens.length !== tableIds.length || missingIds.length > 0 || extraIds.length > 0) {
        errors.push(
          `冲突：docs/v2/${path.basename(v17)}:${i + 1} PORT- 行声明 ${declared[1]} / 列出 ${tokens.length}，单点表 ${tableIds.length}（缺 ${missingIds.join("/") || "无"}；多 ${extraIds.join("/") || "无"}）`,
        );
      }
    }
  }
  for (const probe of declProbes) {
    const values = [...probe.text.matchAll(probe.re)].map((m) => Number(m[1]));
    if (values.length === 0) {
      notes.push(`${probe.label} 未命中（声明面可读性下降，跳过；不阻塞）`);
      continue;
    }
    stats.declarations += values.length;
    for (const v of values) {
      if (v !== rows.length) {
        errors.push(`口径冲突：${probe.label} 声明 ${v} ≠ 单点表 ${rows.length}（13/14 计数分歧即此类）`);
      }
    }
  }

  // ⑥ 他卷零冲突：docs/v2 其余卷零端口路径 / 零「PORT- ＋ 落点文件」同句；源卷 §二 之外同规
  const concretePathRe = /ports\/([A-Za-z0-9_-]+\.(?:ts|mts|cts))/g;
  const mappedFileList = mappedFiles;
  const scanOutside = (lines, label, skipRange) => {
    for (let i = 0; i < lines.length; i++) {
      if (skipRange !== null && i >= skipRange.start && i < skipRange.end) continue;
      const line = lines[i];
      for (const m of line.matchAll(concretePathRe)) {
        errors.push(`冲突：${label}:${i + 1} 出现端口路径 ${m[0]}（端口-文件映射唯一源＝${path.basename(docPath)} §二）`);
      }
      if (/PORT-[A-Z0-9]+/.test(line)) {
        const claim = mappedFileList.find((f) => line.includes("`" + f + "`"));
        if (claim !== undefined) {
          errors.push(
            `冲突：${label}:${i + 1} 出现表外映射声明「${claim}」（同句 PORT-；唯一源＝${path.basename(docPath)} §二）`,
          );
        }
      }
    }
  };
  if (fs.existsSync(docsDir)) {
    for (const name of fs.readdirSync(docsDir).sort()) {
      if (!name.endsWith(".md")) continue;
      const abs = path.join(docsDir, name);
      if (path.resolve(abs) === docPath) continue;
      if (new RegExp(`^${SOURCE_VOLUME}-`).test(name)) continue; // 源卷按卷号排除（--doc 覆盖时亦然）
      stats.scannedVolumes += 1;
      scanOutside(readText(abs).split("\n"), `docs/v2/${name}`, null);
    }
  }
  if (section !== null) {
    scanOutside(docText.split("\n"), path.basename(docPath), section);
  }

  return { errors, notes, stats };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const readFlag = (flag) => {
    const i = args.indexOf(flag);
    if (i < 0) return undefined;
    const v = args[i + 1];
    if (v === undefined || v.startsWith("--")) return null;
    return v;
  };
  const rootFlag = readFlag("--root");
  const docFlag = readFlag("--doc");
  const portsFlag = readFlag("--ports");
  if (rootFlag === null || docFlag === null || portsFlag === null) {
    console.error("[port-map-rescan] FAIL 参数缺值：--root/--doc/--ports 若给出必须紧跟一个路径");
    return 1;
  }
  const root = rootFlag === undefined ? path.resolve(import.meta.dirname, "..", "..") : path.resolve(rootFlag);

  const options = {};
  if (docFlag !== undefined) options.doc = docFlag;
  if (portsFlag !== undefined) options.ports = portsFlag;

  const { errors, notes, stats } = checkPortMap(root, options);

  console.log(`[port-map-rescan] 源 ${String(stats.sourceDoc || "docs/v2/14-*")} §二；落点 ${PORTS_REL}/`);
  for (const n of notes) console.log(`[port-map-rescan] 注 ${n}`);
  const uniqueErrors = [...new Set(errors)];
  if (uniqueErrors.length > 0) {
    for (const e of uniqueErrors) console.error(`[port-map-rescan] FAIL ${e}`);
    console.error(
      `port-map-rescan FAIL：${uniqueErrors.length} 项差异（缺失 ${stats.missing} / 多余 ${stats.extra} / 冲突 ${stats.conflicts}；映射单点不成立）`,
    );
    return 1;
  }

  console.log(`[port-map-rescan] OK ① 单点表 ${stats.rows} 行：PORT-ID 唯一 / 落点唯一 / 平铺 .ts`);
  console.log(`[port-map-rescan] OK ② 映射落点实存 ${stats.mappedFiles}/${stats.rows}（0 缺失）`);
  console.log(`[port-map-rescan] OK ③ 落点自证 ${stats.mappedFiles}/${stats.mappedFiles} 声明 PORT- 常量；承载件 0 处双源声明`);
  console.log(
    `[port-map-rescan] OK ④ 目录实况 ${stats.onDiskFiles} 件 = 映射 ${stats.mappedFiles} ＋ 承载 ${stats.supportFiles}；0 多余；≤${maxFilesPerDirectory}`,
  );
  console.log(
    `[port-map-rescan] OK ⑤ 口径声明 ${stats.declarations} 处均 = ${stats.rows}；v2/17 §三 PORT- 名单${stats.idLists > 0 ? "与表同集合" : "比对跳过（见注）"}`,
  );
  console.log(`[port-map-rescan] OK ⑥ 他卷端口路径 0 处（docs/v2 其余 ${stats.scannedVolumes} 卷零冲突；源卷 §二 之外 0 处）`);
  console.log(
    `port-map-rescan PASS：F5 端口-文件映射单点复扫 6/6（${stats.rows} PORT ↔ ${stats.onDiskFiles} 文件；0 缺失 / 0 多余 / 0 冲突）`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
