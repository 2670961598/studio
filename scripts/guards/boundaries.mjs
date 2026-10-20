#!/usr/bin/env node
// boundaries.mjs —— 分层宪法机械门禁（执行引擎；DEV-47 / studio-dev-90）
// 宪法：docs/20-工程总规程.md §十五；规则数据唯一源：./boundary-rules.mjs（本引擎零仓内知识）。
// 零依赖（node:fs/node:path）；Node 24 直跑。用法：
//   node scripts/guards/boundaries.mjs [--root <目录>]   # 默认仓根；违例 exit 1
//   node scripts/guards/boundaries.mjs --list-over-limit # 列当前 >600 行件（基线维护面，exit 0）
// 机制保证非自律：bun run test 已前置串接本门禁（package.json scripts.test）。

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { rules } from "./boundary-rules.mjs";

// ── 基础件 ────────────────────────────────────────────────────────────────────

/** wc -l 口径：末行无换行符计 1 行，空文件 0 行。 */
export function countLines(text) {
  if (text === "") return 0;
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

const STATIC_IMPORT_RE = /\b(?:import|export)\b[^;'"]*?\bfrom\b\s*["']([^"']+)["']/g;
const BARE_IMPORT_RE = /(?:^|[;\s])import\s*["']([^"']+)["']/g;
const DYNAMIC_IMPORT_RE = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

/** 提取一个模块的全部依赖说明符（静态/裸/动态；type-only 计入——类型依赖也是依赖）。 */
export function extractImportSpecs(source) {
  const specs = new Set();
  for (const re of [STATIC_IMPORT_RE, BARE_IMPORT_RE, DYNAMIC_IMPORT_RE]) {
    re.lastIndex = 0;
    for (const m of source.matchAll(re)) specs.add(m[1]);
  }
  return [...specs];
}

const toPosix = (p) => p.split(path.sep).join("/");
const isCodeFile = (rel, r = rules) => r.codeExtensions.some((e) => rel.endsWith(e));

/** 仓相对路径 → 包目录名（apps/daemon → daemon；packages/store → store；范围外 null）。 */
export function packageOf(relPath, r = rules) {
  const seg = toPosix(relPath).split("/");
  if (seg.length < 3) return null;
  const [kind, name] = seg;
  if (kind !== "apps" && kind !== "packages") return null;
  return name;
}

/** 是否在宪法扫描范围内：apps/*|packages/* 下的 src/|test/ 树内。 */
export function inScope(relPath, r = rules) {
  const seg = toPosix(relPath).split("/");
  if (seg.length < 4) return false;
  if (!r.scopeDirs.includes(seg[0])) return false;
  return seg[2] === "src" || seg[2] === "test";
}

/** daemon src 内相对路径 → 纵轴层名（engine/<特性>/x.ts 归 engine；范围外 null）。 */
export function daemonLayerOf(relToDaemonSrc) {
  const seg = toPosix(relToDaemonSrc).split("/");
  if (seg.length === 1) return seg[0] === "index.ts" ? "root" : null;
  if (seg[0] === "engine" && seg[1] === "tools") return "engine/tools";
  if (["engine", "control", "evolve", "cli", "assembly"].includes(seg[0])) return seg[0];
  return null;
}

/** 依赖说明符归类+解析。返回 {kind, pkg?, targetRel?, layerTo?, layerFrom?} 供各检查器消费。 */
export function resolveSpec(fromRel, spec, root, r = rules) {
  const out = { spec };
  if (spec.startsWith("node:")) return { ...out, kind: "builtin" };
  if (spec.startsWith(r.workspaceScope)) {
    const pkg = spec.slice(r.workspaceScope.length).split("/")[0];
    return { ...out, kind: "workspace", pkg };
  }
  if (spec.startsWith("./") || spec.startsWith("../")) {
    const abs = path.resolve(root, path.dirname(toPosix(fromRel)), spec);
    const targetRel = toPosix(path.relative(root, abs));
    const pkg = packageOf(targetRel, r);
    if (pkg === null) return { ...out, kind: "escape", targetRel };
    return { ...out, kind: pkg === packageOf(fromRel, r) ? "intra" : "cross", pkg, targetRel };
  }
  return { ...out, kind: "external" };
}

// ── 扫描件 ────────────────────────────────────────────────────────────────────

/** 全量走查仓内文件（跳过 node_modules/.git），返回仓相对路径列表。 */
export function walkRepo(root, r = rules) {
  const out = [];
  const recurse = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) recurse(p);
      else if (e.isFile()) out.push(toPosix(path.relative(root, p)));
    }
  };
  for (const d of r.scopeDirs) recurse(path.join(root, d));
  return out;
}

const violation = (rule, file, detail) => ({ rule, file, detail });

// ── 检查器一：daemon 纵轴（层间只准沿冻结边自上而下；同域互引自由） ──────────

export function checkDaemonVertical(files, read, root, r = rules) {
  const v = [];
  const edgeSet = new Set(r.allowedVerticalEdges.map(([a, b]) => `${a}\u0000${b}`));
  for (const f of files) {
    if (!f.startsWith("apps/daemon/src/") || !isCodeFile(f, r)) continue;
    const fromLayer = daemonLayerOf(f.slice("apps/daemon/src/".length));
    if (fromLayer === null) continue; // 平面散文件由 BC-V2 收口
    for (const spec of extractImportSpecs(read(f))) {
      const res = resolveSpec(f, spec, root, r);
      if (res.kind !== "intra") continue;
      const t = res.targetRel;
      if (!t.startsWith("apps/daemon/src/")) {
        if (t.startsWith("apps/daemon/")) {
          v.push(violation("BC-V1", f, `→ ${t}：src 不得引 src 树之外的 daemon 面（test/production 单向：test→src 合法，src→test 违例）`));
        }
        continue; // 出包面归横向检查
      }
      const toLayer = daemonLayerOf(t.slice("apps/daemon/src/".length));
      if (toLayer === null || toLayer === fromLayer) continue;
      if (!edgeSet.has(`${fromLayer}\u0000${toLayer}`)) {
        v.push(
          violation(
            "BC-V1",
            f,
            `→ ${t}：${fromLayer} → ${toLayer} 层间边未冻结（只准自上而下沿 §十五.二纵向表；同域互引自由；新边=改表=提案流）`,
          ),
        );
      }
    }
  }
  return v;
}

// ── 检查器二：横轴（包间边白名单；越界相对引用） ─────────────────────────────

export function checkHorizontal(files, read, root, r = rules) {
  const v = [];
  const edgeSet = new Set(r.allowedPackageEdges.map(([a, b]) => `${a}\u0000${b}`));
  for (const f of files) {
    if (!inScope(f, r) || !isCodeFile(f, r)) continue;
    const fromPkg = packageOf(f, r);
    for (const spec of extractImportSpecs(read(f))) {
      const res = resolveSpec(f, spec, root, r);
      if (res.kind === "escape") {
        v.push(violation("BC-H2", f, `→ ${spec}（解析 ${res.targetRel}）：相对引用越出包边界（包自包含；跨包走 @studio-next/* 且须在 §十五.二横向表）`));
        continue;
      }
      if (res.kind !== "workspace" && res.kind !== "cross") continue;
      const toPkg = res.kind === "workspace" ? res.pkg : res.pkg;
      if (!(toPkg in r.packageLayers)) {
        v.push(violation("BC-H2", f, `→ ${spec}：未登记的工作区包 ${toPkg}（新包=横轴扩域=提案流：packageLayers 加行）`));
        continue;
      }
      if (toPkg === fromPkg) continue;
      if (!edgeSet.has(`${fromPkg}\u0000${toPkg}`)) {
        v.push(
          violation(
            "BC-H1",
            f,
            `→ ${spec}：${fromPkg} → ${toPkg} 包间边未冻结（§十五.二横向表；层位只准高引低；新边=改表=提案流）`,
          ),
        );
      }
    }
  }
  return v;
}

// ── 检查器三：平面纪律（src 根纯入口；域平面基线；tools 升格阈） ─────────────

export function checkPlanes(files, r = rules) {
  const v = [];
  const daemonSrc = "apps/daemon/src";
  const srcFiles = files.filter((f) => f.startsWith(`${daemonSrc}/`) && isCodeFile(f, r));
  const rel = (f) => f.slice(`${daemonSrc}/`.length);

  // BC-V2：src 根=纯入口（index.ts + 五域目录）
  for (const f of srcFiles) {
    const rr = rel(f);
    if (!rr.includes("/") && !r.daemonSrcRootFiles.includes(rr)) {
      v.push(violation("BC-V2", f, "src 根平面散文件（根=纯入口：index.ts+五域目录；D2 裁定，§十五.四.3）"));
    }
  }
  const knownDirs = new Set([...r.daemonSrcRootDirs, "engine/tools"]);
  const rootDirs = new Set(
    srcFiles
      .map((f) => rel(f).split("/")[0])
      .filter((d) => rel(srcFiles.find((x) => rel(x).split("/")[0] === d && rel(x).includes("/")) ?? "").includes("/")),
  );
  const actualDirs = new Set(srcFiles.filter((f) => rel(f).includes("/")).map((f) => rel(f).split("/")[0]));
  for (const d of actualDirs) {
    if (!knownDirs.has(d)) {
      v.push(violation("BC-V2", `${daemonSrc}/${d}/`, "src 根出现未冻结顶层目录（五域之外=提案流改宪法）"));
    }
  }

  // BC-V3：域平面基线（只减不增；新特性=<域>/<特性>/ 子文件夹）
  for (const [domain, cap] of Object.entries(r.domainPlaneBaselines)) {
    const n = srcFiles.filter((f) => rel(f).split("/")[0] === domain && rel(f).split("/").length === 2).length;
    if (n > cap) {
      v.push(violation("BC-V3", `${daemonSrc}/${domain}/`, `域平面 ${n} 件 > 冻结基线 ${cap}（contrib 模式：新特性开 <域>/<特性>/ 子文件夹；平面只减不增=改表=提案流）`));
    }
  }

  // BC-V4：base 升格阈值（engine/tools/ >10 件 → 升格 packages/base）
  const tools = srcFiles.filter((f) => rel(f).startsWith("engine/tools/") && rel(f).split("/").length === 3).length;
  if (tools > r.toolsPromotionFileCount) {
    v.push(violation("BC-V4", `${daemonSrc}/engine/tools/`, `工具件 ${tools} 件 > 升格阈 ${r.toolsPromotionFileCount}（base 升格路径触发：升格 packages/base，方向表加行=提案流，§十五.五）`));
  }
  return v;
}

// ── 检查器四：尺寸阈值（目录 >25 切子域；文件 >600 拆+行数基线 ratchet） ──────

export function checkSizes(files, read, r = rules) {
  const v = [];
  const dirCount = new Map();
  const codeFiles = [];
  for (const f of files) {
    if (!inScope(f, r)) continue;
    const seg = toPosix(f).split("/");
    const dir = seg.slice(0, -1).join("/");
    if (!seg[seg.length - 1].startsWith(".")) dirCount.set(dir, (dirCount.get(dir) ?? 0) + 1);
    if (isCodeFile(f, r)) codeFiles.push(f);
  }
  for (const [dir, n] of dirCount) {
    if (n > r.maxFilesPerDirectory) {
      v.push(violation("BC-S1", `${dir}/`, `目录直属 ${n} 文件 > 阈 ${r.maxFilesPerDirectory}（必须切子域，§十五.三.1）`));
    }
  }
  for (const f of codeFiles) {
    const lines = countLines(read(f));
    if (lines <= r.maxLinesPerFile) continue;
    const cap = r.lineBaseline[f];
    if (cap === undefined) {
      v.push(violation("BC-S2", f, `${lines} 行 > 阈 ${r.maxLinesPerFile}（必须拆；新超限件入基线=改宪法=提案流，§十五.三.3）`));
    } else if (lines > cap) {
      v.push(violation("BC-S2", f, `${lines} 行 > 冻结基线 ${cap}（基线只减不增：先拆再增功能，或走提案流上调，§十五.三.3）`));
    }
  }
  return v;
}

// ── 总装 ──────────────────────────────────────────────────────────────────────

/** 全检。read=文件读取函数（测试面可注入内存实现）。返回 { violations, stats }。 */
export function runGuard(root, r = rules, read = (f) => fs.readFileSync(path.join(root, f), "utf8")) {
  const files = walkRepo(root, r);
  const violations = [
    ...checkDaemonVertical(files, read, root, r),
    ...checkHorizontal(files, read, root, r),
    ...checkPlanes(files, r),
    ...checkSizes(files, read, r),
  ].sort((a, b) => a.rule.localeCompare(b.rule) || a.file.localeCompare(b.file));
  const stats = {
    scannedFiles: files.length,
    scopedCodeFiles: files.filter((f) => inScope(f, r) && isCodeFile(f, r)).length,
    byRule: violations.reduce((m, x) => ({ ...m, [x.rule]: (m[x.rule] ?? 0) + 1 }), {}),
  };
  return { violations, stats };
}

const formatViolation = (x) => `[${x.rule}] ${x.file} —— ${x.detail}`;

/** CLI 入口。 */
function main() {
  const args = process.argv.slice(2);
  const rootFlag = args.indexOf("--root");
  const root = rootFlag >= 0 ? path.resolve(args[rootFlag + 1]) : path.resolve(import.meta.dirname, "..", "..");

  if (args.includes("--list-over-limit")) {
    const files = walkRepo(root, rules).filter((f) => inScope(f, rules) && isCodeFile(f, rules));
    const over = files
      .map((f) => [f, countLines(fs.readFileSync(path.join(root, f), "utf8"))])
      .filter(([, n]) => n > rules.maxLinesPerFile)
      .sort((a, b) => b[1] - a[1]);
    for (const [f, n] of over) console.log(`${String(n).padStart(5)}  ${f}  ${rules.lineBaseline[f] !== undefined ? `(基线 ${rules.lineBaseline[f]})` : "(未入基线)"}`);
    console.log(`over-limit 文件 ${over.length} 件（阈 ${rules.maxLinesPerFile}；维护面，exit 0）`);
    return 0;
  }

  const { violations, stats } = runGuard(root);
  for (const x of violations) console.error(formatViolation(x));
  if (violations.length === 0) {
    console.log(`边界门禁 PASS：扫描 ${stats.scannedFiles} 文件（范围面代码件 ${stats.scopedCodeFiles}），0 违例（分层宪法 20-§十五）`);
    return 0;
  }
  console.error(`边界门禁 FAIL：${violations.length} 违例 ${JSON.stringify(stats.byRule)}（分层宪法 20-§十五；修法见各条尾注）`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
