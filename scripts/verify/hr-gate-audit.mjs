#!/usr/bin/env node
// hr-gate-audit.mjs —— 任职闸门「接线审计断言」（studio-dev-550；NEG-REC-02 代偿面收敛）
//
// 依据：
//   - docs/v2/02 §三（任职六状态状态机）＋§3.4（**非在岗态不得发起出工**——目标闸门）；
//   - docs/v2/11 §14.2（迁移边/触发者）；docs/v2/14 PORT-HR；
//   - docs/v2/17 GAP-V2-06 / NEG-REC-02（代偿面＝REC-LIFE-02＋审计断言；本脚本即
//     「审计断言」的机械腿：把「闸门是否真接在派发链上」变成可重复的仓内检查）；
//   - docs/17-§2 相位 3 派发、docs/17-§6 收割四要件（本闸不改四要件）。
//
// 校验六件事（任一不满足 → exit 1）：
//   ① 事实面件在：engine/hr-gate/employment-gate.ts（归一/留痕）＋engine-seam.ts（engine 接缝）；
//   ② 判定面件在：core employment/gate.ts（employmentAllowsDispatch，只有 in-service 放行）
//      ＋core decide.ts 引用它且 HOLD_NOT_IN_SERVICE 在理由码/ HoldAction 联合里；
//   ③ 决策位接线：tick/state-diff.ts 的 WorkCandidateHost 带 employmentOf 事实入参
//      （work/intake.ts 把事实装进 decide 入参——判定面零复制）；
//   ④ 执行位兜底：dispatch/execute.ts 在装配/launch 前调 rt.hrGate.refusalOf(person.id)；
//   ⑤ 生产装配恒 strict：assembly/serve/runtime.ts 注入 `hrGate: { mode: 'strict' }` 且启动
//      日志含「任职闸门已装配」（真机验证据此 grep）；
//   ⑥ 观测/留痕面在：tick/run.ts 拍首 beginTick ＋汇报 hrGate（TickReport）且台账留痕走
//      既有 ESCALATE note `HR_GATE;REFUSED`（事件枚举冻结，不新增事件名）。
//
// 零依赖（node:fs/node:path）；Node 24 直跑。用法：
//   node scripts/verify/hr-gate-audit.mjs [--root <仓根>]   # 违例 exit 1
//
// 边界：本脚本只做**接线/形状**的机械断言（防回退：闸门被摘线/事件名被改/生产降级），
// 不替代行为用例（红→绿行为面＝apps/daemon/test/v2/engine/hr-gate.test.ts）。

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.argv.includes("--root") ? process.argv[process.argv.indexOf("--root") + 1] : ".");
const failures = [];
let checks = 0;

/** 读文件（不存在=记失败并返回空串） */
function read(rel) {
  checks += 1;
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    failures.push(`缺件：${rel}`);
    return "";
  }
  return fs.readFileSync(abs, "utf8");
}

/** 断言：文件文本包含 needles（全部命中才算过） */
function must(rel, needles, why) {
  const text = read(rel);
  if (text === "") return;
  const missing = needles.filter((n) => !text.includes(n));
  if (missing.length > 0) failures.push(`${why}：${rel} 缺 ${missing.map((m) => JSON.stringify(m)).join("、")}`);
}

// ① 事实面/接缝件
must("apps/daemon/src/engine/hr-gate/employment-gate.ts", [
  "export function createEmploymentGate",
  "export function employmentSnapshotOf",
  "export function recordEmploymentRefusal",
  "HR_GATE;REFUSED",
  "docs/v2/02 §3.4",
], "事实面/留痕件形状");
must("apps/daemon/src/engine/hr-gate/engine-seam.ts", ["export function createEmploymentGateSeam", "noteRefusal", "refusalOf"], "engine 接缝件形状");

// ② 判定面
must("packages/core/src/employment/gate.ts", ["export function employmentAllowsDispatch", "in-service", "missing", "conflict", "unknown"], "core 判定面形状");
must("packages/core/src/decide.ts", ["employmentAllowsDispatch", "HOLD_NOT_IN_SERVICE", "employment?: EmploymentGateSnapshot"], "core decide 任职闸门判定/理由码");
must("packages/core/src/index.ts", ["employment/gate.ts"], "core 导出面");

// ③ 决策位接线（事实入参 → decide 入参）
must("apps/daemon/src/engine/tick/state-diff.ts", ["employmentOf: rt.hrGate.employmentOf"], "决策位事实接线（WorkCandidateHost.employmentOf）");
must("apps/daemon/src/engine/work/intake.ts", ["host.employmentOf?.(personId)", "...(employment !== undefined ? { employment } : {})"], "开工门装配任职事实入参");

// ④ 执行位兜底（装配/launch 之前）——顺序断言
must("apps/daemon/src/engine/dispatch/execute.ts", ["const employmentRefusal = rt.hrGate.refusalOf(person.id)"], "执行位兜底（launch 前）");
const execText = fs.readFileSync(path.join(ROOT, "apps/daemon/src/engine/dispatch/execute.ts"), "utf8");
const backstopAt = execText.indexOf("const employmentRefusal = rt.hrGate.refusalOf(person.id)");
const launchAt = execText.indexOf("await rt.dispatchPreflight(", backstopAt);
if (backstopAt < 0 || launchAt < 0 || backstopAt > launchAt) failures.push("执行位兜底不在装配/launch 之前（顺序断言失败）");

// ⑤ 生产装配 strict ＋ 启动日志
must("apps/daemon/src/assembly/serve/runtime.ts", ["hrGate: { mode: 'strict' }", "任职闸门已装配"], "serve 生产装配 strict/启动日志");

// ⑥ 观测面 ＋ 留痕走既有事件名（不新增事件枚举）
must("apps/daemon/src/engine/tick/run.ts", ["rt.hrGate.beginTick()", "hrGate: rt.hrGate.report()"], "拍首清零/TickReport 任职闸门观测面");
must("apps/daemon/src/engine/tick-report/types.ts", ["HrGateTickReport"], "tick report 类型面");
const gateText = read("apps/daemon/src/engine/hr-gate/employment-gate.ts");
if (gateText !== "" && !/emit\('ESCALATE'/.test(gateText)) failures.push("留痕未走既有 ESCALATE 事件名（事件枚举冻结）");

if (failures.length > 0) {
  console.error(`任职闸门审计断言 FAIL：${failures.length} 项（${checks} 个受检点）`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`任职闸门审计断言 PASS：${checks} 个受检点（事实面/判定面/决策位/执行位/生产 strict/观测留痕）`);
