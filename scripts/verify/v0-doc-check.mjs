#!/usr/bin/env node
// v0-doc-check.mjs —— V0 文档机械自检（MIG-08 / IMPL-08-02）
//
// 依据：plan/04 §1.1（V0 文档自检 CI 前置化：六项检查固化、独立文档门、不串 verify:v2）、
//       plan/05 IMPL-08-02（六项检查对 docs/v2＋docs/plan 全库；真悬空=0）、
//       v2/17 §二（V0 六项检查的命令与口径：§二.1 悬空节号引用、§二.2 跨卷 ID 存在性、
//       §二.3 裸字母 ID 族、§二.4 枚举字面量重述、§二.5 节号连续性、§二.6 VEC 复算），
//       v2/17 §二.8（2026-10-28 复扫的分类口径：引文/审计表/登记表不计活引用）、
//       v2/09（ID 族与枚举唯一主表；V2 全库唯一登记处）、v2/10 §七（VEC 向量）、
//       v2/10 §八（诊断码唯一码表）、v2/16 §五（MIG-08 出口口径）。
//
// 六项检查（任一真违例 → exit 1）：
//   ① 悬空节号引用：docs/v2＋docs/plan 里每个 `v2/NN §X[.Y]` 指向的卷/章/节必须存在；
//      前向卷（v2/90、v2/91 未成卷）按 GAP-V2-12 登记，粘连歧义（中文数字与后文粘读）
//      单列登记、不计真悬空；其余为真悬空。
//   ② 跨卷 ID 存在性：族 ID 必须能在 v2/09 §一.1 登记的定义卷（或 09 登记表）全文查到；
//      排除诊断码族（E-/W-<AREA>-NNN，检查四专管）与 v1·82 的 TR- 自产键；
//      计划卷的族段简写（`EVD-01..06` 形）与 REC- 记录族简写（EVD-NN→REC-EVD-NN、
//      ASSET-NN→REC-ASSET-NN）按简写归类，不计悬空。
//   ③ 裸字母 ID 族：`(?<![A-Za-z0-9-])[A-Z][0-9]+[ab]?(?![0-9A-Za-z-])` 全量扫描；
//      按 v2/17 §二.8 的 C1-C7 分类（特许形/09 登记表/审计处置表/卷头注/改号注记/
//      范围计数/17 自检记录）归零；无分类的裸写=真待修（治 K11 同型复发）。
//   ④ 枚举字面量重述：诊断码定义性出现只在 v2/10 §八；ENU 值集（≥3 机器值）在非 09
//      卷的**表行**里成组复述且表块无 `v2/09/ENU-NN/唯一主表` 标注=重述。
//   ⑤ 节号连续性：每卷 `## 〇/一/...` 章序连续、每章 `### n.m` 子节连续（`-补` 同号不重计）。
//   ⑥ 示例值自洽：v2/10 §七 VEC-01..08 用最小 JCS 规范化器复算（键 UTF-16 码元序、
//      JSON 短转义/小写 hex、整数最短十进制；sha256 规范 UTF-8 文本）；VEC-09/10 负向
//      断言组校验「无摘要、期望拒收」。
//
// 零依赖（node:fs/node:path/node:crypto）；Node 24 直跑。用法：
//   node scripts/verify/v0-doc-check.mjs [--root <仓根>]   # 违例 exit 1
//
// 边界：本脚本**不跑** vitest/typecheck/guard（不做测试执行者）；只做文档面机械自检。
//       docs/v2＋docs/plan 只读：本脚本不改任何文档（发现真悬空→停手改主卷，走提案流）。

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

const DOC_DIRS = ["docs/v2", "docs/plan"];
const FORWARD_VOLUMES = new Map([
  [90, "GAP-V2-12：施工总方案卷未成卷（阶段二）"],
  [91, "v2/09 §四版本表：里程碑与验收卷未成卷（阶段二）"],
]);

// ─────────────────────────────────────────────────────────────────────────────
// 通用读取与文本工具
// ─────────────────────────────────────────────────────────────────────────────

/** 收集检查域内的全部 .md（相对路径，posix 分隔符，排序）。 */
export function collectDocs(root) {
  const out = [];
  for (const dir of DOC_DIRS) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith(".md")) out.push(`${dir}/${e.name}`);
    }
  }
  return out.sort();
}

/** 读 v2 卷：编号 → { rel, text, chapters:Set<number>, sections:Set<string> }。 */
export function loadVolumes(root) {
  const volumes = new Map();
  const dir = path.join(root, "docs/v2");
  if (!fs.existsSync(dir)) return volumes;
  for (const name of fs.readdirSync(dir)) {
    const m = /^(\d{2})-.+\.md$/.exec(name);
    if (m === null) continue;
    const rel = `docs/v2/${name}`;
    const text = fs.readFileSync(path.join(root, rel), "utf8");
    const chapters = new Set();
    const sections = new Set();
    for (const line of text.split("\n")) {
      let h = /^##\s+([〇零一二三四五六七八九十]+)、/.exec(line);
      if (h !== null) chapters.add(cnToNumber(h[1]));
      h = /^###\s+([0-9]+(?:\.[0-9]+)*)/.exec(line);
      if (h !== null) {
        sections.add(h[1]);
        chapters.add(Number(h[1].split(".")[0]));
      }
    }
    volumes.set(Number(m[1]), { rel, text, chapters, sections });
  }
  return volumes;
}

/** 剥「」引文（v2/17 §二.8 口径①：引文是登记对象不是导航）；保留行结构。 */
export function stripQuotes(text) {
  return text.replace(/「[^」]*」/g, "");
}

const CN_DIGITS = new Map([
  ["〇", 0],
  ["零", 0],
  ["一", 1],
  ["二", 2],
  ["三", 3],
  ["四", 4],
  ["五", 5],
  ["六", 6],
  ["七", 7],
  ["八", 8],
  ["九", 9],
]);

/** 中文数字归一化（章号最多两位；`二六`→26、`一一`→11、`十五`→15、`二十`→20）。 */
export function cnToNumber(token) {
  if (/^[0-9]+$/.test(token)) return Number(token);
  if (token.includes("十")) {
    const [head, tail] = token.split("十");
    const tens = head === "" ? 1 : CN_DIGITS.get(head);
    const ones = tail === "" ? 0 : CN_DIGITS.get(tail);
    if (tens === undefined || ones === undefined) return Number.NaN;
    return tens * 10 + ones;
  }
  let n = 0;
  for (const ch of token) {
    const d = CN_DIGITS.get(ch);
    if (d === undefined) return Number.NaN;
    n = n * 10 + d;
  }
  return n;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ─────────────────────────────────────────────────────────────────────────────
// 检查一：悬空节号引用（v2/17 §二.1）
// ─────────────────────────────────────────────────────────────────────────────

const V2_REF_RE = /v2\/(\d{1,2})(?:\s*§\s*([〇零一二三四五六七八九十]+|[0-9]+)((?:\.\d+)*))?/g;

/** 中文数字多字 token 的粘连歧义判定：贪心数不存在，但更短前缀是实存章号，且后接汉字。 */
function resolveChapter(token, chapters, after) {
  const direct = cnToNumber(token);
  if (chapters.has(direct)) return { ok: true, n: direct };
  const isChinese = /^[〇零一二三四五六七八九十]+$/.test(token);
  if (!isChinese || token.length < 2) return { ok: false };
  const next = after.charAt(0);
  if (!/[\u3400-\u9fff]/.test(next)) return { ok: false };
  for (let len = token.length - 1; len >= 1; len--) {
    const n = cnToNumber(token.slice(0, len));
    if (chapters.has(n)) return { ok: false, ambiguous: true, n };
  }
  return { ok: false };
}

/** 检查一：返回 { errors, warnings, stats }。 */
export function checkDanglingSections(root, docs, volumes) {
  const errors = [];
  const warnings = [];
  const stats = { files: docs.length, refs: 0, lines: 0, dangling: 0, ambiguous: 0, forward: 0 };
  const seenLines = new Set();
  for (const rel of docs) {
    const lines = stripQuotes(fs.readFileSync(path.join(root, rel), "utf8")).split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const m of line.matchAll(V2_REF_RE)) {
        const volNo = Number(m[1]);
        const chapterToken = m[2];
        const sub = m[3] ?? "";
        stats.refs += 1;
        seenLines.add(`${rel}:${i + 1}`);
        const vol = volumes.get(volNo);
        if (vol === undefined) {
          if (FORWARD_VOLUMES.has(volNo)) {
            stats.forward += 1;
            continue;
          }
          stats.dangling += 1;
          errors.push(`检查一 悬空：${rel}:${i + 1} 引用 ${m[0]}（v2/${m[1]} 卷不存在）`);
          continue;
        }
        if (chapterToken === undefined) continue;
        const after = line.slice((m.index ?? 0) + m[0].length);
        const chapter = resolveChapter(chapterToken, vol.chapters, after);
        if (chapter.ok) {
          if (sub === "") continue;
          const key = `${chapter.n}${sub}`;
          if (!vol.sections.has(key)) {
            stats.dangling += 1;
            errors.push(`检查一 悬空：${rel}:${i + 1} 引用 ${m[0]}（v2/${m[1]} 无节 ${key}）`);
          }
          continue;
        }
        if (chapter.ambiguous === true) {
          stats.ambiguous += 1;
          warnings.push(
            `检查一 粘连歧义（登记不判负）：${rel}:${i + 1} 引用 ${m[0]}（贪心章号不存在，前缀 v2/${m[1]} §${chapter.n} 实存；建议加间隔）`,
          );
          continue;
        }
        if (sub !== "") {
          const chNum = cnToNumber(chapterToken);
          if (vol.chapters.has(chNum)) {
            stats.dangling += 1;
            errors.push(`检查一 悬空：${rel}:${i + 1} 引用 ${m[0]}（v2/${m[1]} 无节 ${chNum}${sub}）`);
            continue;
          }
        }
        stats.dangling += 1;
        errors.push(`检查一 悬空：${rel}:${i + 1} 引用 ${m[0]}（v2/${m[1]} 无章 ${chapterToken}）`);
      }
    }
  }
  stats.lines = seenLines.size;
  if (stats.forward > 0) {
    warnings.push(
      `检查一 前向引用 ${stats.forward} 处（v2/90、v2/91 未成卷，GAP-V2-12/09 §四版本表登记，不计悬空）`,
    );
  }
  return { errors, warnings, stats };
}

// ─────────────────────────────────────────────────────────────────────────────
// 检查二：跨卷 ID 存在性（v2/17 §二.2；族表源自 v2/09 §一.1）
// ─────────────────────────────────────────────────────────────────────────────

// 族 → { vols: 定义卷编号（v2/09 §一.1 的「定义卷」列）, shape: token 正则（不含外层边界） }。
// 裸字母族（CL/G/D/V/F/B/N 等）不在此表：检查三专管。TR- 为 v1·82 自产键，按 v2/17 §二.2 排除。
const ID_FAMILIES = [
  { prefix: "DEC-84b-", vols: [9], shape: "DEC-84b-\\d{2}" },
  { prefix: "DEC-84-", vols: [9], shape: "DEC-84-\\d{2}" },
  { prefix: "DEC-OPEN-", vols: [9], shape: "DEC-OPEN-\\d{2}" },
  { prefix: "DEC-13-", vols: [13], shape: "DEC-13-\\d{2}" },
  { prefix: "DEC-49-", vols: [9], shape: "DEC-49-\\d{2}" },
  { prefix: "DEC-85c-", vols: [9], shape: "DEC-85c-\\d{2}" },
  { prefix: "DEC-XZ-", vols: [9], shape: "DEC-XZ-\\d{2}" },
  { prefix: "TRUST-SAME", vols: [15], shape: "TRUST-SAME" },
  { prefix: "BIND-LOSS-", vols: [12], shape: "BIND-LOSS-\\d{2}" },
  { prefix: "SEC-ROOT-", vols: [15], shape: "SEC-ROOT-\\d{2}" },
  { prefix: "SEC-FC-", vols: [15], shape: "SEC-FC-\\d{2}" },
  { prefix: "SEC-SIG-", vols: [15], shape: "SEC-SIG-\\d{2}" },
  { prefix: "SEC-WD-", vols: [15], shape: "SEC-WD-\\d{2}" },
  { prefix: "SEC-SEC-", vols: [15], shape: "SEC-SEC-\\d{2}" },
  { prefix: "SEC-T", vols: [15], shape: "SEC-T\\d" },
  { prefix: "SEC-RD-", vols: [15], shape: "SEC-RD-\\d{2}" },
  { prefix: "SEC-REV-", vols: [15], shape: "SEC-REV-\\d{2}" },
  { prefix: "PORT-", vols: [5, 14], shape: "PORT-[A-Z]+" },
  { prefix: "EXEC-", vols: [7], shape: "EXEC-\\d{2}" },
  { prefix: "EX-", vols: [4], shape: "EX-\\d" },
  { prefix: "EVD-", vols: [8], shape: "EVD-[A-Z0-9-]*\\d" },
  { prefix: "EVCH-", vols: [13], shape: "EVCH-\\d[ab]?" },
  { prefix: "PRM-G", vols: [12], shape: "PRM-G\\d" },
  { prefix: "RULE-", vols: [10], shape: "RULE-\\d{2}" },
  { prefix: "REP-", vols: [13], shape: "REP-\\d" },
  { prefix: "HCL-", vols: [7, 12], shape: "HCL-[0-9][A-Z]?" },
  { prefix: "BIND-", vols: [12], shape: "BIND-[A-Z]+(?:-[A-Z]+)?-\\d{2}" },
  { prefix: "WS-R", vols: [12], shape: "WS-R\\d" },
  { prefix: "REC-", vols: [11], shape: "REC-[A-Z]+-[A-Z0-9]+" },
  { prefix: "SCH-", vols: [10], shape: "SCH-[A-Z]+-\\d{2}" },
  { prefix: "ENC-", vols: [10], shape: "ENC-\\d{2}" },
  { prefix: "VEC-", vols: [10], shape: "VEC-\\d{2}" },
  { prefix: "TOOL-", vols: [13], shape: "TOOL-\\d{2}" },
  { prefix: "MCP-", vols: [14], shape: "MCP-[A-Z]+-\\d{2}" },
  { prefix: "API-", vols: [14], shape: "API-\\d{2}" },
  { prefix: "DISP-", vols: [16], shape: "DISP-\\d{2}" },
  { prefix: "MIG-", vols: [16], shape: "MIG-\\d{2}" },
  { prefix: "ASSET-", vols: [6], shape: "ASSET-\\d{2}" },
  { prefix: "GAP-", vols: [17], shape: "GAP-[A-Z0-9]+-\\d{2}" },
  { prefix: "PB-", vols: [17], shape: "PB-\\d" },
  { prefix: "NEG-", vols: [17], shape: "NEG-[A-Z]+-\\d{2}" },
  { prefix: "PRB-", vols: [12], shape: "PRB-\\d{2}" },
  { prefix: "CAP-", vols: [7], shape: "CAP-\\d{2}" },
  { prefix: "OBJ-", vols: [5], shape: "OBJ-\\d{2}" },
  { prefix: "DOM-", vols: [5], shape: "DOM-\\d{2}" },
  { prefix: "MEM-", vols: [8], shape: "MEM-\\d{2}" },
  { prefix: "MON-", vols: [8], shape: "MON-(?:\\d{2}|ST)" },
  { prefix: "OBS-", vols: [8], shape: "OBS-\\d{2}" },
  { prefix: "DEP-", vols: [13], shape: "DEP-[A-Z0-9-]+" },
  { prefix: "ENU-", vols: [9], shape: "ENU-\\d{2,3}" },
  { prefix: "TERM-", vols: [9], shape: "TERM-\\d{2}" },
  { prefix: "I-", vols: [1], shape: "I-\\d{1,2}" },
  { prefix: "R-", vols: [1], shape: "R-\\d{1,2}" },
  { prefix: "E-", vols: [2], shape: "E-\\d{1,2}[ab]?" },
  { prefix: "W-", vols: [4], shape: "W-\\d{1,2}" },
  { prefix: "M-", vols: [11], shape: "M-\\d{2}" },
  { prefix: "L-", vols: [11], shape: "L-\\d{2}" },
  { prefix: "O-", vols: [11], shape: "O-\\d{2}" },
];

// 计划卷记录族简写：EVD-NN → REC-EVD-NN；ASSET-NN → REC-ASSET-NN。
const SHORT_ALIASES = [
  { re: /^EVD-(\d{2})$/, to: (m) => `REC-EVD-${m[1]}` },
  { re: /^ASSET-(\d{2})$/, to: (m) => `REC-ASSET-${m[1]}` },
];

const ID_FAMILIES_SORTED = [...ID_FAMILIES].sort((a, b) => b.prefix.length - a.prefix.length);

/** token 是否在指定卷全文（词边界）出现。 */
function tokenInVolumes(token, vols, volumes) {
  const re = new RegExp(`(?<![A-Za-z0-9-])${escapeRe(token)}(?![0-9A-Za-z-])`);
  return vols.some((n) => {
    const v = volumes.get(n);
    return v !== undefined && re.test(v.text);
  });
}

/** token 是否在 v2/09 的登记表行（`|` 开头）出现——09 是主表总册，登记行可证存在。 */
function tokenInRegistryTable(token, volumes) {
  const vol = volumes.get(9);
  if (vol === undefined) return false;
  const re = new RegExp(`(?<![A-Za-z0-9-])${escapeRe(token)}(?![0-9A-Za-z-])`);
  return vol.text.split("\n").some((line) => line.trimStart().startsWith("|") && re.test(line));
}

/** token 是否落在 `..`/`–`/`—`/`＋` 等范围或连接符旁（族段简写端点，不单判）。 */
function nearRangeMarker(line, index, token) {
  const before = line.slice(Math.max(0, index - 2), index);
  const after = line.slice(index + token.length, index + token.length + 2);
  return /(?:\.\.|[–—＋+])$/.test(before) || /^(?:\.\.|[–—＋+])/.test(after);
}

/** 检查二：返回 { errors, warnings, stats }。 */
export function checkIdExistence(root, docs, volumes) {
  const errors = [];
  const warnings = [];
  const stats = { tokens: 0, families: ID_FAMILIES_SORTED.length, ranged: 0, shorthand: 0, dangling: 0 };
  for (const rel of docs) {
    const lines = stripQuotes(fs.readFileSync(path.join(root, rel), "utf8")).split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const taken = [];
      const overlaps = (a, b) => taken.some(([s, e]) => a < e && b > s);
      for (const fam of ID_FAMILIES_SORTED) {
        const re = new RegExp(`(?<![A-Za-z0-9-])(${fam.shape})(?![0-9A-Za-z-])`, "g");
        for (const m of line.matchAll(re)) {
          const start = m.index ?? 0;
          const end = start + m[0].length;
          if (overlaps(start, end)) continue;
          taken.push([start, end]);
          stats.tokens += 1;
          const token = m[0];
          if (nearRangeMarker(line, start, token)) {
            stats.ranged += 1;
            continue;
          }
          if (tokenInVolumes(token, fam.vols, volumes) || tokenInRegistryTable(token, volumes)) continue;
          const alias = SHORT_ALIASES.find((a) => a.re.test(token));
          if (alias !== undefined) {
            const target = token.replace(alias.re, (...args) => alias.to(args));
            if (tokenInVolumes(target, [11], volumes)) {
              stats.shorthand += 1;
              continue;
            }
          }
          stats.dangling += 1;
          errors.push(
            `检查二 悬空：${rel}:${i + 1} 引用 ${token}（v2/09 定义卷 v2/${fam.vols.join("/v2/")} 查无此 ID）`,
          );
        }
      }
    }
  }
  warnings.push(`检查二 覆盖 ${stats.families} 个连字符族（v2/09 §一.1 定义卷；裸字母族 CL/G/D/V/F/B/N 归检查三；TR- 为 v1·82 自产键，按 v2/17 §二.2 排除）`);
  if (stats.shorthand > 0) {
    warnings.push(`检查二 记录族简写按别名解析 ${stats.shorthand} 处（EVD-NN→REC-EVD-NN、ASSET-NN→REC-ASSET-NN）`);
  }
  if (stats.ranged > 0) warnings.push(`检查二 族段范围端点跳过 ${stats.ranged} 处（.. 简写端点不单判）`);
  return { errors, warnings, stats };
}

// ─────────────────────────────────────────────────────────────────────────────
// 检查三：裸字母 ID 族扫描（v2/17 §二.3/§二.8-二；F6 面）
// ─────────────────────────────────────────────────────────────────────────────

const BARE_TOKEN_RE = /(?<![A-Za-z0-9-])([A-Z][0-9]+[ab]?)(?![0-9A-Za-z-])/g;

// C1 特许形（v2/17 §二.8-二 C1；含 09 §一.3 外部引证族与 09 §五 DEC 编号的裸形别名）。
const C1_ALLOW = [
  /^V2$/,
  /^V[0-8]$/,
  /^V0[5-9]$/,
  /^V1[01]$/,
  /^G[1-9]$/,
  /^D[1-9]$/,
  /^D1a$/,
  /^K(?:[1-9]|1[01])$/,
  /^C[1-7][ab]?$/,
  /^H[0-3][ab]$/,
  /^P[0-3]$/,
  /^F[1-8]$/,
  /^B(?:[1-9]|1[0-3])$/,
  /^S[1-5]$/,
  /^L[0-5]$/,
  /^X[2-4]$/,
  /^Q(?:[1-9]|10)$/,
  /^O[1-5]$/,
  /^N(?:[1-9]|10)$/,
  /^T[1-3]$/,
  /^I[12]$/,
  /^W(?:76|79|80)$/,
];

// C3/C5 语境：审计处置表、承接范围行、改号注记、复核/修订记录（v2/17 §二.8-二 C3/C5）。
const META_CONTEXT_RE =
  /(?:审计|复核|修订|修复|改号|废止|作废|裸写|已解|已修|待修|登记|引文|原文|历史|轮次|收口|复扫|扫描|审查|评审|口径|注记|GLM|DSF|L3[A-Z]|K\d|P0-|V\d+-P|84b|v1)/;

/** 检查三：返回 { errors, warnings, stats }。 */
export function checkBareFamilies(root, docs) {
  const errors = [];
  const warnings = [];
  const stats = { tokens: 0, c1: 0, c2: 0, c3: 0, c4: 0, c5: 0, c6: 0, c7: 0, pending: 0 };
  for (const rel of docs) {
    const lines = stripQuotes(fs.readFileSync(path.join(root, rel), "utf8")).split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isTableRow = line.trimStart().startsWith("|");
      const is09 = rel.includes("docs/v2/09-");
      const isHeader = line.trimStart().startsWith(">");
      const meta = META_CONTEXT_RE.test(line);
      for (const m of line.matchAll(BARE_TOKEN_RE)) {
        const token = m[0];
        const index = m.index ?? 0;
        stats.tokens += 1;
        if (C1_ALLOW.some((re) => re.test(token))) {
          stats.c1 += 1;
          continue;
        }
        // C2：09 登记表行（唯一主表允许写字面量/旧号）。
        if (is09 && isTableRow) {
          stats.c2 += 1;
          continue;
        }
        // C3：审计处置表/承接范围行/改号注记/meta。
        if (isTableRow && meta) {
          stats.c3 += 1;
          continue;
        }
        // C4：卷头注/上位声明/审计输入。
        if (isHeader) {
          stats.c4 += 1;
          continue;
        }
        // C5：非表行的修订/复核/审计/改号注记。
        if (meta) {
          stats.c5 += 1;
          continue;
        }
        // C6：范围端点、计数并列（`I17＋R11 段行/36 ID` 形）。
        const before = line.slice(Math.max(0, index - 2), index);
        const after = line.slice(index + token.length, index + token.length + 4);
        const countCtx =
          /(?:\.\.|[–—＋+])$/.test(before) ||
          /^(?:\.\.|[–—＋+]|段行|\s*ID|\s*行)/.test(after) ||
          /追溯行合计|段行\/\d+\s*ID/.test(line);
        if (countCtx) {
          stats.c6 += 1;
          continue;
        }
        // C7：计划卷自身的编号记号（plan/07 P1-P4 悬置项、84b 抉择 R 引文、docs/89 复核项 M）。
        if (rel.startsWith("docs/plan/")) {
          const planCtx =
            /^P[1-4]$/.test(token) ||
            /^D1[0-2]$/.test(token) ||
            (/^M[1-8]$/.test(token) && /(?:治|旧|复核|修复|docs\/89)/.test(line)) ||
            (/^R(?:[1-9]|10)$/.test(token) && /(?:三主体|84b)/.test(line));
          if (planCtx) {
            stats.c7 += 1;
            continue;
          }
        }
        stats.pending += 1;
        errors.push(
          `检查三 裸字母：${rel}:${i + 1} 出现 ${token}（未入 C1-C7 分类；F6 禁裸写，改前缀式 ID 或登记 09）`,
        );
      }
    }
  }
  warnings.push(
    `检查三 分类：C1 特许形 ${stats.c1}／C2 09 登记表 ${stats.c2}／C3 审计表 ${stats.c3}／C4 卷头注 ${stats.c4}／C5 改号注记 ${stats.c5}／C6 范围计数 ${stats.c6}／C7 计划卷编号 ${stats.c7}`,
  );
  return { errors, warnings, stats };
}

// ─────────────────────────────────────────────────────────────────────────────
// 检查四：枚举字面量重述（v2/17 §二.4/§二.8-三；F2 面）
// ─────────────────────────────────────────────────────────────────────────────

const DIAG_CODE_RE = /\b[EW]-(?:ENC|SCH|RULE)-\d{3}\b/g;

/** 从 09 §二 表提取 ENU 候选（≥3 个反引号机器值）。 */
function parseEnuCandidates(volumes) {
  const vol = volumes.get(9);
  if (vol === undefined) return [];
  const sec = vol.text.split("\n## 二、")[1]?.split("\n## 三、")[0] ?? "";
  const out = [];
  for (const line of sec.split("\n")) {
    const m = /^\|\s*(ENU-\d{2,3})\s*\|([^|]*)\|([^|]*)\|/.exec(line);
    if (m === null) continue;
    const values = [...new Set([...m[3].matchAll(/`([^`]+)`/g)].map((x) => x[1]))];
    if (values.length >= 3) out.push({ id: m[1], name: m[2].trim(), values });
  }
  return out;
}

/** 检查四：返回 { errors, warnings, stats }。 */
export function checkEnumRestatement(root, docs, volumes) {
  const errors = [];
  const warnings = [];
  const stats = { codes: 0, codeRefs: 0, enu: 0, restated: 0 };
  const vol10 = volumes.get(10);
  if (vol10 === undefined) {
    errors.push("检查四 缺 v2/10（诊断码唯一码表与枚举主卷不可判）");
    return { errors, warnings, stats };
  }
  // ① 诊断码：10 §八 定义表 = 唯一码表；他卷只许引用。
  const codeSec = vol10.text.split("\n## 八、")[1]?.split("\n## 九、")[0] ?? "";
  const defined = new Set();
  for (const line of codeSec.split("\n")) {
    const m = /^\|\s*`?([EW]-(?:ENC|SCH|RULE)-\d{3})`?\s*\|/.exec(line);
    if (m !== null) defined.add(m[1]);
  }
  stats.codes = defined.size;
  if (defined.size !== 25) errors.push(`检查四 诊断码定义 ${defined.size} 个 ≠ 25（10 §八 码集应封闭）`);
  for (const rel of docs) {
    const lines = fs.readFileSync(path.join(root, rel), "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isDefRow = line.trimStart().startsWith("|") && /^\|\s*`?[EW]-(?:ENC|SCH|RULE)-\d{3}`?\s*\|/.test(line);
      for (const m of line.matchAll(DIAG_CODE_RE)) {
        stats.codeRefs += 1;
        if (rel === vol10.rel) continue;
        if (isDefRow) {
          errors.push(`检查四 码表重述：${rel}:${i + 1} 表行定义 ${m[0]}（唯一码表在 v2/10 §八）`);
          continue;
        }
        const referenceCtx = /v2\/10|10\s*§八|§八|NEG-|码|登记|定义|引用|唯一码表|拒收/.test(line);
        if (!referenceCtx) {
          errors.push(`检查四 码义不明：${rel}:${i + 1} 出现 ${m[0]} 但无「v2/10 §八/引用/登记」上下文`);
        }
      }
    }
  }

  // ② 值集级：09 §二 的 ≥3 值 ENU，非 09 卷表行成组复述且表块无唯一主表标注=重述。
  const enus = parseEnuCandidates(volumes);
  stats.enu = enus.length;
  for (const rel of docs) {
    if (rel.includes("docs/v2/09-")) continue;
    const lines = fs.readFileSync(path.join(root, rel), "utf8").split("\n");
    // 按连续表行切块；表块上下文 = 表首前 2 行＋表体。
    let i = 0;
    while (i < lines.length) {
      if (!lines[i].trimStart().startsWith("|")) {
        i += 1;
        continue;
      }
      const start = i;
      while (i < lines.length && lines[i].trimStart().startsWith("|")) i += 1;
      const block = lines.slice(Math.max(0, start - 2), i).join("\n");
      if (/v2\/09|ENU-\d|唯一主表|字面量主表|值集.{0,4}主表/.test(block)) continue;
      for (let row = start; row < i; row++) {
        const line = lines[row];
        for (const enu of enus) {
          const hit = enu.values.filter((v) => line.includes(`\`${v}\``)).length;
          if (hit >= 3) {
            stats.restated += 1;
            errors.push(
              `检查四 值集重述：${rel}:${row + 1} 表行成组复述 ${enu.id}（${enu.name}）${hit} 个机器值且表块无 v2/09 标注`,
            );
          }
        }
      }
    }
  }
  return { errors, warnings, stats };
}

// ─────────────────────────────────────────────────────────────────────────────
// 检查五：节号连续性（v2/17 §二.5）
// ─────────────────────────────────────────────────────────────────────────────

/** 检查五：返回 { errors, stats }。 */
export function checkSectionContinuity(root, docs) {
  const errors = [];
  const stats = { files: 0, chapters: 0, numericSections: 0, problems: 0 };
  for (const rel of docs) {
    stats.files += 1;
    const lines = fs.readFileSync(path.join(root, rel), "utf8").split("\n");
    const chapters = [];
    const sections = new Map(); // 章号 → Set<二级号>
    const deeper = new Map(); // "n.m" → Set<三级号>
    for (const line of lines) {
      let m = /^##\s+([〇零一二三四五六七八九十]+)、/.exec(line);
      if (m !== null) {
        chapters.push({ n: cnToNumber(m[1]), label: m[1] });
        continue;
      }
      m = /^###\s+([0-9]+(?:\.[0-9]+)*)/.exec(line);
      if (m === null) continue;
      const parts = m[1].split(".").map(Number);
      stats.numericSections += 1;
      if (parts.length === 2) {
        const [ch, sec] = parts;
        if (!sections.has(ch)) sections.set(ch, new Set());
        sections.get(ch).add(sec);
      } else if (parts.length >= 3) {
        const key = `${parts[0]}.${parts[1]}`;
        if (!deeper.has(key)) deeper.set(key, new Set());
        deeper.get(key).add(parts[2]);
      }
    }
    stats.chapters += chapters.length;
    if (chapters.length === 0) {
      errors.push(`检查五 节号：${rel} 无「## X、」章标题`);
      stats.problems += 1;
      continue;
    }
    if (chapters[0].n > 1) {
      errors.push(`检查五 节号：${rel} 首章为「${chapters[0].label}」（应从 〇 或 一 起）`);
      stats.problems += 1;
    }
    for (let k = 1; k < chapters.length; k++) {
      if (chapters[k].n !== chapters[k - 1].n + 1) {
        errors.push(`检查五 节号：${rel} 章序断档「${chapters[k - 1].label}」→「${chapters[k].label}」`);
        stats.problems += 1;
      }
    }
    const checkSeq = (label, nums, where) => {
      const sorted = [...nums].sort((a, b) => a - b);
      if (sorted.length > 0 && sorted[0] > 1) {
        errors.push(`检查五 节号：${rel} ${where} 首号为 ${sorted[0]}（应从 1 起）`);
        stats.problems += 1;
      }
      for (let k = 1; k < sorted.length; k++) {
        if (sorted[k] !== sorted[k - 1] + 1) {
          errors.push(`检查五 节号：${rel} ${where} 断档 ${sorted[k - 1]}→${sorted[k]}`);
          stats.problems += 1;
        }
      }
    };
    for (const [ch, nums] of sections) checkSeq("章", nums, `第 ${ch} 章子节`);
    for (const [key, nums] of deeper) checkSeq("节", nums, `第 ${key} 节子节`);
  }
  return { errors, stats };
}

// ─────────────────────────────────────────────────────────────────────────────
// 检查六：示例值自洽——VEC 复算（v2/17 §二.6；F1 面）
// ─────────────────────────────────────────────────────────────────────────────

/** 最小 JCS 规范化器（键按 UTF-16 码元序；字符串走 JSON.stringify 短转义/小写 hex；整数最短十进制）。 */
export function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("非有限数值");
    return String(value === 0 ? 0 : value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(",")}}`;
  }
  throw new Error(`不可规范化的值类型：${typeof value}`);
}

export const sha256Hex = (text) => crypto.createHash("sha256").update(text, "utf8").digest("hex");

// VEC-06：RFC 8785 §3.2.3 官方键集（07 键；值照 RFC 原文）。
const VEC06_OBJECT = {
  "\u20ac": "Euro Sign",
  "\r": "Carriage Return",
  "\ufb33": "Hebrew Letter Dalet With Dagesh",
  "1": "One",
  "\ud83d\ude00": "Emoji: Grinning Face",
  "\u0080": "Control",
  "\u00f6": "Latin Small Letter O With Diaeresis",
};

/** 取一行表格单元格里的反引号代码片段。 */
function codeSpans(cell) {
  return [...cell.matchAll(/`([^`]*)`/g)].map((m) => m[1]);
}

/** 检查六：返回 { errors, stats }。 */
export function checkVec(root, volumes) {
  const errors = [];
  const stats = { vectors: 0, positive: 0, negative: 0 };
  const vol10 = volumes.get(10);
  if (vol10 === undefined) {
    errors.push("检查六 缺 v2/10（VEC 向量主卷不可判）");
    return { errors, stats };
  }
  const sec = vol10.text.split("\n## 七、")[1]?.split("\n## 八、")[0] ?? "";
  const rows = new Map();
  for (const line of sec.split("\n")) {
    if (!line.trimStart().startsWith("|")) continue;
    const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    const idm = /^(VEC-\d{2})$/.exec(cells[0] ?? "");
    if (idm !== null) rows.set(idm[1], cells);
  }
  stats.vectors = rows.size;
  if (rows.size !== 10) errors.push(`检查六 VEC 表行 ${rows.size} 条 ≠ 10（10 §七 应 VEC-01..10）`);

  const positiveIds = ["VEC-01", "VEC-02", "VEC-03", "VEC-04", "VEC-05", "VEC-06", "VEC-07", "VEC-08"];
  for (const id of positiveIds) {
    const cells = rows.get(id);
    if (cells === undefined) {
      errors.push(`检查六 缺 ${id} 行`);
      continue;
    }
    const digestMatch = /[0-9a-f]{64}/.exec(cells[3] ?? "");
    if (digestMatch === null) {
      errors.push(`检查六 ${id} 期望摘要缺失/形态非法`);
      continue;
    }
    const expectedDigest = digestMatch[0];
    if (id === "VEC-06") {
      const text = canonicalize(VEC06_OBJECT);
      const got = sha256Hex(text);
      if (got !== expectedDigest) {
        errors.push(`检查六 ${id} 复算不符：got ${got} expected ${expectedDigest}`);
        continue;
      }
      stats.positive += 1;
      continue;
    }
    const input = codeSpans(cells[1] ?? "")[0];
    if (input === undefined) {
      errors.push(`检查六 ${id} 输入代码片段缺失`);
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(input);
    } catch {
      errors.push(`检查六 ${id} 输入不是合法 JSON：${input.slice(0, 40)}`);
      continue;
    }
    const canonical = canonicalize(parsed);
    const expectedText = codeSpans(cells[2] ?? "")[0];
    const want = cells[2]?.startsWith("原样") === true ? input : expectedText;
    if (want === undefined) {
      errors.push(`检查六 ${id} 期望规范文本缺失`);
      continue;
    }
    if (canonical !== want) {
      errors.push(`检查六 ${id} 规范文本不符：got ${canonical.slice(0, 80)} expected ${want.slice(0, 80)}`);
      continue;
    }
    const got = sha256Hex(canonical);
    if (got !== expectedDigest) {
      errors.push(`检查六 ${id} 摘要不符：got ${got} expected ${expectedDigest}`);
      continue;
    }
    if (id === "VEC-05") {
      const byteDigest = /byteDigest[^`]*`([0-9a-f]{64})`/.exec(cells[4] ?? "");
      const byteGot = sha256Hex(input);
      if (byteDigest === null) errors.push(`检查六 ${id} byteDigest 期望值缺失`);
      else if (byteGot !== byteDigest[1]) errors.push(`检查六 ${id} byteDigest 不符：got ${byteGot} expected ${byteDigest[1]}`);
      else stats.positive += 1;
    } else {
      stats.positive += 1;
    }
  }

  // VEC-09/10：负向断言组（期望=拒收，无摘要）。
  for (const id of ["VEC-09", "VEC-10"]) {
    const cells = rows.get(id);
    if (cells === undefined) {
      errors.push(`检查六 缺 ${id} 行`);
      continue;
    }
    if (!/—/.test(cells[3] ?? "")) {
      errors.push(`检查六 ${id} 负向组不应有摘要（第三列应为 —）`);
      continue;
    }
    if (!/拒收/.test(cells[4] ?? "")) {
      errors.push(`检查六 ${id} 负向组期望须写明「拒收」`);
      continue;
    }
    stats.negative += 1;
  }
  return { errors, stats };
}

// ─────────────────────────────────────────────────────────────────────────────
// 汇总与 CLI
// ─────────────────────────────────────────────────────────────────────────────

/** 跑六项检查：返回 { errors, notes, stats }（无副作用，便于测试面复用）。 */
export function runChecks(root) {
  const docs = collectDocs(root);
  const volumes = loadVolumes(root);
  const errors = [];
  const notes = [];
  if (!docs.some((d) => d.startsWith("docs/v2/"))) errors.push("检查域缺 docs/v2/*.md");
  if (!docs.some((d) => d.startsWith("docs/plan/"))) errors.push("检查域缺 docs/plan/*.md");
  if (volumes.size === 0) errors.push("docs/v2 无可解析卷（v2/NN-*.md）");

  const one = checkDanglingSections(root, docs, volumes);
  const two = checkIdExistence(root, docs, volumes);
  const three = checkBareFamilies(root, docs);
  const four = checkEnumRestatement(root, docs, volumes);
  const five = checkSectionContinuity(root, docs);
  const six = checkVec(root, volumes);
  for (const part of [one, two, three, four, five, six]) {
    errors.push(...part.errors);
    notes.push(...(part.warnings ?? []));
  }
  const stats = {
    docs: docs.length,
    v2: docs.filter((d) => d.startsWith("docs/v2/")).length,
    plan: docs.filter((d) => d.startsWith("docs/plan/")).length,
    volumes: volumes.size,
    one: one.stats,
    two: two.stats,
    three: three.stats,
    four: four.stats,
    five: five.stats,
    six: six.stats,
  };
  return { errors, notes, stats };
}

function main() {
  const args = process.argv.slice(2);
  const rootFlag = args.indexOf("--root");
  const root = rootFlag >= 0 ? path.resolve(args[rootFlag + 1]) : path.resolve(import.meta.dirname, "..", "..");
  const { errors, notes, stats } = runChecks(root);

  for (const n of notes) console.log(`[v0-doc-check] 注 ${n}`);
  if (errors.length > 0) {
    for (const e of errors) console.error(`[v0-doc-check] FAIL ${e}`);
    console.error(`v0-doc-check FAIL：${errors.length} 项（V0 六项未过，文档门不成立）`);
    return 1;
  }
  console.log(
    `[v0-doc-check] OK ① 检查一 悬空节号引用：${stats.docs} 件文档、引用 ${stats.one.refs} 处（唯一行 ${stats.one.lines}）；真悬空 ${stats.one.dangling}、粘连歧义 ${stats.one.ambiguous}、前向引用 ${stats.one.forward}`,
  );
  console.log(
    `[v0-doc-check] OK ② 检查二 跨卷 ID 存在性：${stats.two.families} 个连字符族、token ${stats.two.tokens} 处；悬空 ${stats.two.dangling}、族段端点 ${stats.two.ranged}、记录族简写 ${stats.two.shorthand}`,
  );
  console.log(
    `[v0-doc-check] OK ③ 检查三 裸字母 ID 族：token ${stats.three.tokens} 处；C1-C7 全分类，真待修 ${stats.three.pending}`,
  );
  console.log(
    `[v0-doc-check] OK ④ 检查四 枚举字面量重述：诊断码定义 ${stats.four.codes} 个全在 v2/10 §八（引用 ${stats.four.codeRefs} 处）；ENU 候选 ${stats.four.enu} 条，跨卷表行重述 ${stats.four.restated}`,
  );
  console.log(
    `[v0-doc-check] OK ⑤ 检查五 节号连续性：${stats.five.files} 件、章 ${stats.five.chapters} 个、数值子节 ${stats.five.numericSections} 个；问题 ${stats.five.problems}`,
  );
  console.log(
    `[v0-doc-check] OK ⑥ 检查六 示例值自洽：VEC ${stats.six.vectors} 条；正向复算 ${stats.six.positive}/8、负向断言 ${stats.six.negative}/2`,
  );
  console.log(
    `v0-doc-check PASS：V0 六项 6/6（docs/v2 ${stats.v2} 卷＋docs/plan ${stats.plan} 卷；真悬空 ${stats.one.dangling}）`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
