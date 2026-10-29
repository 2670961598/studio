#!/usr/bin/env node
// evidence-channel.mjs —— 证据通道受理件（NEG-ENG-05 / V0·纪律）
//
// 依据：docs/v2/13 §1.5「证据通道（TOOL-07）」与 §七-4（不用 eval/stdin 作证据通道；
//       README 的裸 `bun <file.ts>` 属开发便利，验收须以 `mise exec -- node` 等价重跑）、
//       docs/v2/17 §4.4 NEG-ENG-05（构造场景＝用 eval/stdin 形态当验证证据；预期＝拒，
//       一律 `.ts` 文件或 `mise exec -- node` 等价重跑）、docs/plan/04 §六.6（证据通道纪律）、
//       docs/probe/neg-ring-eng/report.md §7.7（缺口：「证据通道」受理件 0 命中；本件即受理门）。
//
// 受理口径（唯一；多一条都不是本件）：
//   ① 只收 `--file <仓相对 .ts>` 或位置参数 `<仓相对 .ts>`；相对基准是**仓根**
//      （由本文件位置推导 `scripts/verify/../..`），与调用时 cwd 无关；
//   ② 拒收：eval/stdin 形态（`-e`/`--eval`/`-p`/`--print`/`--input-type`）、stdin（`-`）、
//      内联代码、非 `.ts`、绝对路径（即使指向仓内）、含 `..` 段或越出仓根（含符号链接逃逸）、
//      不存在的路径、非常规文件；任何拒收一律 exit 1；
//   ③ 成功输出单行 JSON `{"ok":true,"file":"<仓相对 posix>","sha256":"<hex64>"}`（exit 0；
//      `file` 是真实路径的仓相对形态，符号链接已解析）；失败输出单行 JSON
//      `{"ok":false,"error":{"code":"…","message":"…"}}`（stderr，exit 1）。
//
// 不做什么（边界）：
//   - **不执行证据代码**：不 spawn、不 eval、不 import、不读 stdin；只做路径受理与内容指纹登记。
//     等价重跑由调用方执行 `mise exec -- node <file>`（本件不代跑、也不判定「跑过没有」）。
//   - 不写文件、不改任何证据；不新增记录类/端口，也不把本件的 reason token 冒充领域诊断码
//     （v2/10 §八 的码形与登记规则不适用；本件 token 只用于 exit 1 的原因判别）。
//   - 不做「验证结论」：sha256 只证「受理的是这份字节」，不证证据有效/通过/可复现。
//
// 用法：
//   node scripts/verify/evidence-channel.mjs --file packages/contract/src/index.ts
//   node scripts/verify/evidence-channel.mjs packages/contract/src/index.ts
//
// 零依赖（node:fs/node:path/node:crypto）；Node 24 直跑。

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 仓根（词法路径；真实路径在 main 里 realpath 后用于包含判定）。 */
const SCRIPT_ROOT = path.resolve(import.meta.dirname, "..", "..");

/** 拒收原因 token（受理件本地面；不登记 v2/09，不冒充 v2/10 §八 诊断码）。 */
export const REJECT = Object.freeze({
  NO_INPUT: "EVIDENCE_CHANNEL_NO_INPUT",
  MISSING_FILE_VALUE: "EVIDENCE_CHANNEL_MISSING_FILE_VALUE",
  MULTIPLE_INPUTS: "EVIDENCE_CHANNEL_MULTIPLE_INPUTS",
  EVAL_FORBIDDEN: "EVIDENCE_CHANNEL_EVAL_FORBIDDEN",
  STDIN_FORBIDDEN: "EVIDENCE_CHANNEL_STDIN_FORBIDDEN",
  INLINE_CODE: "EVIDENCE_CHANNEL_INLINE_CODE",
  UNKNOWN_FLAG: "EVIDENCE_CHANNEL_UNKNOWN_FLAG",
  ABSOLUTE_PATH: "EVIDENCE_CHANNEL_ABSOLUTE_PATH",
  PATH_ESCAPE: "EVIDENCE_CHANNEL_PATH_ESCAPE",
  NOT_TS: "EVIDENCE_CHANNEL_NOT_TS",
  NOT_FOUND: "EVIDENCE_CHANNEL_NOT_FOUND",
  NOT_REGULAR_FILE: "EVIDENCE_CHANNEL_NOT_REGULAR_FILE",
  READ_FAILED: "EVIDENCE_CHANNEL_READ_FAILED",
  INTERNAL_ERROR: "EVIDENCE_CHANNEL_INTERNAL_ERROR",
});

// ── 拒收载体（普通对象，不用 class；Symbol 只做本文件内判别） ──────────────────
const REJECTION = Symbol("evidence-channel-rejection");

function rejection(code, message) {
  return { [REJECTION]: true, code, message };
}

function isRejection(value) {
  return typeof value === "object" && value !== null && value[REJECTION] === true;
}

/** 回显值截断：错误信息可复核但不把长内联代码整段喷进日志。 */
function quote(value) {
  const text = String(value);
  return JSON.stringify(text.length > 80 ? `${text.slice(0, 80)}…` : text);
}

const toPosix = (p) => p.split(path.sep).join("/");

// ── 参数面：eval/stdin 形态先判，再判「一个 .ts 目标」 ───────────────────────

const EVAL_EXACT = new Set(["-e", "--eval", "-p", "--print", "--input-type"]);
const EVAL_PREFIXES = ["--eval=", "--print=", "--input-type="];

/** eval/stdin 形态：单独成 token 或 `-eCODE`/`--eval=CODE` 附着形态。 */
function isEvalToken(arg) {
  if (EVAL_EXACT.has(arg)) return true;
  if (!arg.startsWith("--") && (arg.startsWith("-e") || arg.startsWith("-p"))) return true;
  return EVAL_PREFIXES.some((prefix) => arg.startsWith(prefix));
}

function takeSingle(current, value) {
  if (current !== null) {
    throw rejection(
      REJECT.MULTIPLE_INPUTS,
      `只受理一个证据文件：已有 ${quote(current)}，又收到 ${quote(value)}`,
    );
  }
  return value;
}

/** 返回唯一目标串（仓相对路径）；只做形状判定，不做文件系统访问。 */
function parseArgs(argv) {
  // 先全量扫 forbidden token：`--file -e …` 这种「把 eval 当 --file 值」也逃不过。
  for (const arg of argv) {
    if (isEvalToken(arg)) {
      throw rejection(
        REJECT.EVAL_FORBIDDEN,
        `拒收 eval/stdin 形态：${quote(arg)}；证据只认仓内 .ts 文件（等价重跑用 mise exec -- node <file>）`,
      );
    }
    if (arg === "-") {
      throw rejection(
        REJECT.STDIN_FORBIDDEN,
        "拒收 stdin（`-`）；本件不读 stdin，证据只认仓内 .ts 文件",
      );
    }
  }

  let target = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--file") {
      const value = argv[i + 1];
      if (value === undefined) {
        throw rejection(REJECT.MISSING_FILE_VALUE, "`--file` 缺少路径：用法 --file <仓相对 .ts>");
      }
      i += 1;
      if (value.startsWith("-")) {
        throw rejection(REJECT.UNKNOWN_FLAG, `--file 的值是选项形态：${quote(value)}；只收仓相对 .ts 路径`);
      }
      target = takeSingle(target, value);
      continue;
    }
    if (arg.startsWith("-")) {
      throw rejection(
        REJECT.UNKNOWN_FLAG,
        `未知选项 ${quote(arg)}；本件只接受 --file <仓相对 .ts> 或位置参数 <仓相对 .ts>`,
      );
    }
    target = takeSingle(target, arg);
  }
  if (target === null) {
    throw rejection(
      REJECT.NO_INPUT,
      "未给证据文件；本件不读 stdin、不执行内联代码，只收仓内 .ts 文件",
    );
  }
  return target;
}

// ── 路径面：形状 → 词法包含 → 真实路径包含 ───────────────────────────────────

/** Windows 盘符/UNC 形态（POSIX 上 path.isAbsolute 不识别，属绝对路径逃逸）。 */
const WINDOWS_ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\\\\|\/\/)/;

/** 非 .ts 输入里的「像代码」提示：空白/括号/分号/引号/反引号/重定向等（`/` 不算，路径要用）。 */
const CODE_SHAPE = /[\s(){};=+*%<>|&`"'$\\]/;

function isOutside(rel) {
  return path.isAbsolute(rel) || rel === ".." || rel.startsWith(`..${path.sep}`);
}

/** 词法受理：返回绝对候选路径；所有拒收判定先于任何文件系统访问。 */
function acceptPath(target, root) {
  if (target === "") {
    throw rejection(REJECT.NO_INPUT, "证据文件参数为空；用法 --file <仓相对 .ts>");
  }
  if (target.trim() !== target || /[\u0000-\u001f\u007f]/u.test(target)) {
    throw rejection(
      REJECT.INLINE_CODE,
      `拒收含首尾空白/控制字符的输入：${quote(target)}；证据只认仓内 .ts 文件路径`,
    );
  }
  if (path.isAbsolute(target) || WINDOWS_ABSOLUTE.test(target)) {
    throw rejection(
      REJECT.ABSOLUTE_PATH,
      "拒收绝对路径（即使指向仓内）：证据记录只登记仓相对路径，避免本机路径入账；请给仓相对 .ts",
    );
  }
  if (!target.endsWith(".ts")) {
    if (CODE_SHAPE.test(target)) {
      throw rejection(
        REJECT.INLINE_CODE,
        `拒收内联代码：${quote(target)}；证据只认仓内 .ts 文件（不执行、不解析代码）`,
      );
    }
    throw rejection(REJECT.NOT_TS, `只受理 .ts 文件：${quote(target)}`);
  }
  // 规范仓相对路径：含 `..` 段（含 Windows 分隔符形态）一律不受理——登记面不留歧义路径
  if (target.split(/[\\/]/).includes("..")) {
    throw rejection(
      REJECT.PATH_ESCAPE,
      `拒收含 \`..\` 段的路径：${quote(target)}；只收规范仓相对 .ts（不做父目录回溯）`,
    );
  }

  const lexical = path.resolve(root, target);
  const lexicalRel = path.relative(root, lexical);
  if (isOutside(lexicalRel)) {
    throw rejection(
      REJECT.PATH_ESCAPE,
      `路径越出仓根：${quote(target)}（词法解析为仓外 ${quote(toPosix(lexicalRel))}）；只受理仓内 .ts`,
    );
  }
  return { lexical, lexicalRel };
}

/** 真实路径受理：符号链接必须仍落在仓根内（防「仓内链接指仓外」）。 */
function acceptRealPath(lexical, lexicalRel, root) {
  let real;
  try {
    real = fs.realpathSync(lexical);
  } catch (err) {
    throw errnoRejection(err, quote(toPosix(lexicalRel)));
  }
  const realRel = path.relative(root, real);
  if (isOutside(realRel)) {
    throw rejection(
      REJECT.PATH_ESCAPE,
      `符号链接指向仓外：${quote(toPosix(lexicalRel))}（真实路径 ${quote(toPosix(realRel))}）；只受理仓内 .ts`,
    );
  }
  return { real, realRel };
}

function errnoRejection(err, label) {
  const code =
    typeof err === "object" && err !== null && "code" in err ? String(err.code) : "";
  if (code === "ENOENT" || code === "ENOTDIR") {
    return rejection(REJECT.NOT_FOUND, `证据文件不存在：${label}`);
  }
  return rejection(REJECT.READ_FAILED, `证据文件不可读：${label}（${code === "" ? "未知错误" : code}）`);
}

// ── 读面：只读字节做指纹；绝不执行 ───────────────────────────────────────────

function readBytes(realPath, label) {
  let fd;
  try {
    fd = fs.openSync(realPath, "r");
  } catch (err) {
    throw errnoRejection(err, label);
  }
  try {
    if (!fs.fstatSync(fd).isFile()) {
      throw rejection(REJECT.NOT_REGULAR_FILE, `不是常规文件：${label}`);
    }
    return fs.readFileSync(fd);
  } catch (err) {
    if (isRejection(err)) throw err;
    throw errnoRejection(err, label);
  } finally {
    fs.closeSync(fd);
  }
}

const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

function emitAccept(file, digest) {
  process.stdout.write(`${JSON.stringify({ ok: true, file, sha256: digest })}\n`);
  return 0;
}

function emitReject(code, message) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: { code, message } })}\n`);
  return 1;
}

// ── 主入口 ───────────────────────────────────────────────────────────────────

function main(argv) {
  try {
    const target = parseArgs(argv);
    const root = fs.realpathSync(SCRIPT_ROOT);
    const { lexical, lexicalRel } = acceptPath(target, root);
    const { real, realRel } = acceptRealPath(lexical, lexicalRel, root);
    const file = toPosix(realRel);
    const bytes = readBytes(real, quote(file));
    return emitAccept(file, sha256(bytes));
  } catch (err) {
    if (isRejection(err)) return emitReject(err.code, err.message);
    const message = err instanceof Error ? err.message : String(err);
    return emitReject(REJECT.INTERNAL_ERROR, `受理件内部错误：${message}`);
  }
}

/** 直接执行判定：按真实路径比较（相对路径调用、链接调用都成立）。 */
function isDirectRun() {
  const invoked = process.argv[1];
  if (invoked === undefined) return false;
  try {
    return fs.realpathSync(invoked) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  process.exit(main(process.argv.slice(2)));
}
