/**
 * sandbox —— 进化链沙箱执行器（「候选制品→沙箱→三态闸门」链的沙箱环节，20-§九）
 *
 * 规格依据（实现单引用）：
 *   - docs/20-§九：一切改进走候选制品管线（观测→提案→**沙箱**→三态闸门→灰度→切权→复盘）——
 *     本文件是链上「沙箱」一环的真执行面。验证闸精神承自旧系统 tools/sandbox-verify.sh：
 *     一切改进/建议必须先在临时目录沙箱验证（补丁+测试+针对性验证），确认价值后进生产
 *     （实现单转述 20-§四；原文勘定疑点见「文档疑点」末段）。
 *   - docs/17-§3 进化行：候选制品（谱系）→沙箱→三态闸门——沙箱产物（verification 快照）
 *     是闸门输入（core evolution.ts：sandboxPass≠true → reject，fail-closed）。
 *   - docs/02 F3-01（统一入口禁旁路）/ F3-02（四元组缺一不进闸门）/ F3-03（三态闸门 fail-closed）。
 *   - packages/store ledger.updateVerification：证据写面——只允许 sandboxed 态写入
 *     （窗口闸）；沙箱完成点的正式落列通道（e2e 裸 SQL 模拟的正式化，v5 增补面）。
 *   - packages/core evolution.ts：状态机 proposed→sandboxed 机器边；verification 非 null
 *     才可 sandboxed→gated（沙箱证据是闸门前置）。
 *   - docs/17-§11 安全模型：沙箱与探针集**物理隔离**——本执行器不触碰探针集任何资产
 *     （探针面归探针单，本文件零探针引用）。
 *
 * 形态对齐先例：
 *   - 端口形态对齐 src/gate.ts（GateRunner 端口 + createDefaultGateRunner 默认实现）——
 *     本文件出 SandboxRunner 端口 + createSandboxRunner 默认实现（可注入替身）。
 *   - 子进程管理对齐 test/crash-injection.test.ts / crash-points.ts 的 spawn 面（真子进程、
 *     退出面一次定局、不盲等定时）；超时杀用**进程组 SIGKILL**（adapters killpg 同精神：
 *     shell 包装下杀整组，不留孙进程悬挂；close 事件收口=exit+stdio 冲刷双到，杀后 2s
 *     宽限兜底 fd 被 escaped 进程持有的病态面）。
 *
 * 核心手法——**临时目录法**（结构性零触碰生产）：
 *   mkdtemp 临时目录 → 拷贝目标资产相关最小集（v0：资产文件本身 + 同目录测试文件若存在）
 *   → 应用变更（v0=文件替换对列表）→ 跑冻结验收命令（子进程，timeoutMs 超时杀）
 *   → 产出 SandboxReport → tmp 用后清理。
 *   结构性保证：本模块对生产文件系统**只有 readFileSync/statSync/readdirSync 读路径**；
 *   一切写入收口在 writeInsideTmp 唯一写口——目的地 resolve 后必须仍在 tmp 根内（路径
 *   逃逸即拒）；本模块全部 fs 写调用 = writeInsideTmp / mkdtemp / rm(tmp)，全部 tmp 域——
 *   头注与测试双重证明（测试断言生产树前后逐字节一致）。
 *
 * fail-closed 分类（失败如实，不伪造不隐瞒）：
 *   - 无验收命令（testCommand 空）→ fail 'command-missing'——验收命令冻结后禁改（20-§六.2），
 *     无命令=不可验证=不过（实现单口径「plan 必填 command——无命令即 fail 如实」）；
 *   - 资产缺失/不可读 → fail 'asset-missing'；
 *   - 路径逃逸（asset_path / 补丁路径 resolve 出 tmp 根，含绝对路径与 ../ 形态）→
 *     fail 'path-escape'（不跑命令）；
 *   - 补丁应用失败 → fail 'patch-failed'（不跑命令）；
 *   - 命令非零退出 / spawn 层失败 → fail 'command-failed'（exitCode / note 如实）；
 *   - 超时 → 进程组 SIGKILL → fail 'timeout'（timedOut=true）。
 *   例外（fail-fast 上抛 CONFIG_INVALID，不进报告）：plan 形状坏（timeoutMs 非正整数 /
 *   patch 项缺字段）、链面状态违规（候选不在库 / 机器边非法）——调用方 bug 属代码级问题，
 *   观察不掩盖（evolve-guard 同款纪律）；机器边判定**只走 core transitionCandidate 单一
 *   状态机**，本文件不复制判定面（store 同款纪律）。
 *
 * 拟稿待批点（本文件口径，汇报后走批示流）：
 *   - **同目录测试文件判定**（SIBLING_TEST_FILE_RE）：v0 冻结正则 = 基名匹配
 *     `(test|spec).{扩展}`（a.test.ts / a.spec.js / test.ts …）或 `test-`/`test_` 前缀。
 *     拷贝面=资产同目录一层（不递归）；清单化「资产→测试集」映射归后续刀。
 *   - **verification 快照形状**：{sandboxPass, blastRadiusOk: false, sandbox: {报告摘要}}——
 *     GateEvidence 兼容面（core gate 只读 sandboxPass/blastRadiusOk/judges）+ sandbox
 *     报告快照（人读/审计）。blastRadiusOk 字面 false：影响面检查**不在本刀**（灰度/探针
 *     面归后续刀），未证实即不声称（fail-closed）——闸门面按 F3-03 定档 escalate，与
 *     「初期建议全 escalate 再放开」一致。judges 不由沙箱写（F3-05 异源监控单）。
 *   - **CLI 链退出码**：链走完（证据落账+迁移完成）即 exit 0——判定红是进化链的**正常
 *     产物**（evolution-e2e 场景 C：v1 沙箱红→rejected 是档案面），非命令错误；用法/库/
 *     候选/状态面错误才 exit 1。自动化读台账判定，不信退出码。
 *   - **--file 单文件语义**：v0 变更文件=候选资产自身的整文件替换对（新内容全文）；
 *     多文件变更/真 unified diff 应用归后续刀。
 *   - **diff_hash 不复核**：v0 不校验变更文件哈希与候选 diff_hash 一致（登记面语义归
 *     提案刀）；沙箱只对「拟应用变更」跑验收，如实记录。
 *   - **验收超时缺省 60_000ms**：CLI --timeout 可覆写；缺省档拟稿。
 *
 * 后续刀（本刀不做，头注声明）：灰度（shadow 并行记账+决策字段级 diff，F3-04）、切权
 *   （supervisor 重启加载，17-§2）、复盘（POSTMORTEM）、serve 主循环自动跑沙箱（进化链
 *   daemon 化）——本刀只到「一条 CLI 链把进沙箱变一条命令」（bin.ts sandbox 子命令）。
 *
 * 文档疑点（如实上报）：实现单引 20-§四 验证闸原文「一切改进/建议必须先在临时目录沙箱
 *   验证（补丁+测试+针对性验证），确认价值后进生产——旧系统 tools/sandbox-verify.sh 的
 *   精神」；现行 docs/20-§四 为分支三级晋升流程（feature→dev→gray→release），未载此句，
 *   全文检索「临时目录沙箱 / sandbox-verify」零命中——疑源自旧系统文档或未入库版本，
 *   本文件按实现单转述语义施工（沙箱=改进进生产的闸前环节，与 20-§九 管线序一致），
 *   原文勘定走批示流。
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { configInvalid } from '@studio-next/contract'
import { transitionCandidate as coreTransition } from '@studio-next/core'
import type { CandidateRecord } from '@studio-next/core'
import type { CandidateRow, Ledger } from '@studio-next/store'

// ————————————————————————— 端口形状 —————————————————————————

/** 沙箱输入的候选最小面（core CandidateRecord / store CandidateRow 的结构子集——三键必备） */
export interface SandboxCandidate {
  id: string
  /** 资产定位键（相对 plan.assetRoot 解析） */
  asset_path: string
  diff_hash: string
}

/** v0 补丁形态：文件替换对（相对 tmp 根的 posix 路径 × 新内容全文——整文件替换，非 unified diff） */
export interface PatchPair {
  path: string
  content: string
}

/** 沙箱计划（CLI 链组装；实现单口径 plan={拟应用补丁?, testCommand, timeoutMs}+资产根） */
export interface SandboxPlan {
  /** 生产资产根（asset_path 相对此根**只读**解析；生产面零写——结构性保证见头注） */
  assetRoot: string
  /** 拟应用补丁（可选——缺省=只在既有资产面跑验收命令） */
  patch?: readonly PatchPair[]
  /** 冻结验收命令（shell 形态，cwd=tmp；空串=无命令→fail 'command-missing' 如实） */
  testCommand: string
  /** 验收命令超时毫秒（到点进程组 SIGKILL） */
  timeoutMs: number
}

/** 失败分类（fail-closed，证据如实——语义见头注） */
export type SandboxFailReason =
  | 'command-missing'
  | 'asset-missing'
  | 'path-escape'
  | 'patch-failed'
  | 'command-failed'
  | 'timeout'

/** 沙箱报告（证据面：stdout/stderr 为摘要，artifacts=tmp 内产物清单） */
export interface SandboxReport {
  /** 验收判定：命令 exit=0 且此前各步全成才 true（fail-closed） */
  pass: boolean
  /** 失败分类（pass=true 时为 null） */
  failReason: SandboxFailReason | null
  /** 命令 stdout 摘要（超限保头尾+截断标记；早失败=空串） */
  stdout: string
  /** 命令 stderr 摘要（同上） */
  stderr: string
  /** 命令执行耗时 ms（早失败=0） */
  durationMs: number
  /** tmp 内产物清单（命令跑完后全量文件，相对 tmp 根 posix 路径升序） */
  artifacts: readonly string[]
  /** 命令退出码（超时/spawn 失败/未跑=null） */
  exitCode: number | null
  timedOut: boolean
  /** 人读诊断（失败原因补充，如逃逸路径/读失败原文；pass 时缺省） */
  note?: string
}

/** 沙箱执行器端口（形态对齐 GateRunner）：默认实现 createSandboxRunner；测试可注入替身 */
export interface SandboxRunner {
  runSandbox(candidate: SandboxCandidate, plan: SandboxPlan): Promise<SandboxReport>
}

/** 执行器依赖（测试注入面） */
export interface SandboxDeps {
  /** tmp 基目录（缺省 os.tmpdir()；测试给受控目录以断言「用后清理」） */
  tmpBase?: string
  /** 时钟（durationMs 计量；缺省 Date.now——daemon 侧 IO 面可用真时钟） */
  clock?: () => number
}

// ————————————————————————— 冻结常量（拟稿，见头注） —————————————————————————

/**
 * 同目录测试文件判定（v0 冻结拟稿，头注拟稿点）：基名 = `*.test.*`/`*.spec.*`/裸
 * `test.*`，或 `test-`/`test_` 前缀。只筛常规文件、只看资产同目录一层（不递归）。
 */
const SIBLING_TEST_FILE_RE = /(?:^|\.)(?:test|spec)\.[cm]?[jt]sx?$|^test[-_][^/]+$/

/** stdout/stderr 摘要上限：头 2048 + 尾 1024，中段截断标记（证据可读性 vs 体积） */
const SUMMARY_HEAD_CHARS = 2048
const SUMMARY_TAIL_CHARS = 1024
/** 原始输出捕获上限（防命令刷屏撑爆内存；超出丢弃并加标记） */
const RAW_CAPTURE_CAP_CHARS = 1_000_000
/** 杀组后 close 未至的收口宽限（fd 被 escaped 进程持有等病态面；正常杀后毫秒级到） */
const POST_KILL_GRACE_MS = 2_000

// ————————————————————————— 唯一写口（结构性零触碰保证） —————————————————————————

/** 目的地 resolve 后是否仍在 tmp 根内（不含 tmp 根自身——根不是文件目的地） */
function insideTmp(tmpRoot: string, relPath: string): boolean {
  const dest = path.resolve(tmpRoot, relPath)
  return dest.startsWith(tmpRoot + path.sep)
}

/** 路径逃逸（沙箱面转 fail 'path-escape' 报告，不上抛出证据面） */
class PathEscapeError extends Error {
  constructor(relPath: string) {
    super(`路径逃逸：${relPath === '' ? '（空路径）' : relPath}（resolve 后在 tmp 根外——沙箱结构性拒写）`)
  }
}

/**
 * **唯一写口**：本模块对文件系统的全部内容写入都经此函数——目的地必须解析在 tmp 根内，
 * 逃逸即抛 PathEscapeError。结构性保证：除此之外零内容写 API（生产面只读，头注「结构性
 * 保证」段；tmp 根自身的建/删走 mkdtemp / rm(tmp)，同为 tmp 域）。
 */
function writeInsideTmp(tmpRoot: string, relPath: string, content: string | Uint8Array): void {
  if (!insideTmp(tmpRoot, relPath)) throw new PathEscapeError(relPath)
  const dest = path.resolve(tmpRoot, relPath)
  mkdirSync(path.dirname(dest), { recursive: true })
  writeFileSync(dest, content)
}

/** 摘要（超限保头尾+截断标记；rawTruncated=原始捕获已封顶丢弃） */
function summarize(raw: string, rawTruncated: boolean): string {
  let text = raw
  if (rawTruncated) text += '\n…[沙箱捕获：原始输出超限，超出部分丢弃]…'
  if (text.length <= SUMMARY_HEAD_CHARS + SUMMARY_TAIL_CHARS) return text
  const head = text.slice(0, SUMMARY_HEAD_CHARS)
  const tail = text.length - SUMMARY_TAIL_CHARS
  return `${head}\n…[沙箱摘要：中段截断 ${text.length - SUMMARY_HEAD_CHARS - SUMMARY_TAIL_CHARS} 字符]…\n${text.slice(tail)}`
}

/** tmp 内产物清单（递归全量文件；相对 tmp 根 posix 路径升序） */
function listArtifacts(tmpRoot: string): string[] {
  const out: string[] = []
  const walk = (dir: string, rel: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (entry.isDirectory()) walk(path.join(dir, entry.name), childRel)
      else if (entry.isFile()) out.push(childRel)
    }
  }
  walk(tmpRoot, '')
  return out.sort()
}

// ————————————————————————— 默认实现（临时目录法） —————————————————————————

/** 早失败报告速造（未跑命令：exitCode null / duration 0 / artifacts=当下 tmp 产物） */
function earlyFail(failReason: SandboxFailReason, artifacts: readonly string[], note: string): SandboxReport {
  return { pass: false, failReason, stdout: '', stderr: '', durationMs: 0, artifacts, exitCode: null, timedOut: false, note }
}

/** 命令已跑的报告速造（pass 判定=exit 0；fail 时 note 补充） */
function commandReport(
  pass: boolean,
  failReason: SandboxFailReason | null,
  exitCode: number | null,
  timedOut: boolean,
  durationMs: number,
  stdout: string,
  stderr: string,
  artifacts: readonly string[],
  note: string | undefined,
): SandboxReport {
  return {
    pass,
    failReason,
    stdout,
    stderr,
    durationMs,
    artifacts,
    exitCode,
    timedOut,
    ...(note === undefined ? {} : { note }),
  }
}

/** 默认沙箱执行器（临时目录法，流程见头注；零新依赖——node:child_process spawn） */
export function createSandboxRunner(deps: SandboxDeps = {}): SandboxRunner {
  const tmpBase = deps.tmpBase ?? tmpdir()
  const clock = deps.clock ?? Date.now
  return {
    async runSandbox(candidate, plan): Promise<SandboxReport> {
      // —— 形状闸（fail-fast 上抛 CONFIG_INVALID：调用方 bug 不进证据面）——
      if (!Number.isInteger(plan.timeoutMs) || plan.timeoutMs < 1) {
        configInvalid('daemon/sandbox:bad-plan', `timeoutMs 须为正整数，得到 ${String(plan.timeoutMs)}`)
      }
      if (plan.patch !== undefined) {
        for (const pair of plan.patch) {
          if (typeof pair.path !== 'string' || typeof pair.content !== 'string') {
            configInvalid('daemon/sandbox:bad-plan', `patch 项形状坏（path/content 须为字符串）：${JSON.stringify(pair)}`)
          }
        }
      }
      // —— 无命令即 fail 如实（fail-closed：无冻结验收命令=不可验证=不过；先于建 tmp——无谓面不做）——
      if (plan.testCommand.trim() === '') {
        return earlyFail('command-missing', [], '无冻结验收命令（plan.testCommand 空）——不可验证即不过，fail-closed（实现单口径「plan 必填 command——无命令即 fail 如实」）')
      }

      const tmpRoot = await mkdtemp(path.join(tmpBase, 'studio-next-sandbox-'))
      try {
        // —— ① 资产路径卫生：镜像目的地必须可落在 tmp 内（绝对路径 / ../ 形态同判逃逸）——
        if (!insideTmp(tmpRoot, candidate.asset_path)) {
          return earlyFail('path-escape', listArtifacts(tmpRoot), `asset_path 逃逸：${candidate.asset_path}（镜像目的地在 tmp 根外，拒拷）`)
        }

        // —— ② 拷贝最小集·资产文件本身（生产面只读；缺失/非常规文件=fail 如实）——
        const assetAbs = path.resolve(plan.assetRoot, candidate.asset_path)
        let assetIsFile = false
        try {
          assetIsFile = statSync(assetAbs).isFile()
        } catch {
          assetIsFile = false
        }
        if (!assetIsFile) {
          return earlyFail('asset-missing', listArtifacts(tmpRoot), `资产文件缺失或非常规文件：${assetAbs}（资产缺失=fail，fail-closed 如实）`)
        }
        try {
          writeInsideTmp(tmpRoot, candidate.asset_path, readFileSync(assetAbs))
        } catch (err) {
          if (err instanceof PathEscapeError) return earlyFail('path-escape', listArtifacts(tmpRoot), err.message)
          return earlyFail('asset-missing', listArtifacts(tmpRoot), `资产拷贝失败：${err instanceof Error ? err.message : String(err)}`)
        }

        // —— ③ 拷贝最小集·同目录测试文件（v0 冻结正则，头注拟稿点；不递归、只常规文件）——
        const assetDirAbs = path.dirname(assetAbs)
        const assetRelDir = path.posix.dirname(candidate.asset_path)
        try {
          const siblings = readdirSync(assetDirAbs, { withFileTypes: true })
            .filter((e) => e.isFile() && e.name !== path.basename(assetAbs) && SIBLING_TEST_FILE_RE.test(e.name))
            .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
          for (const sibling of siblings) {
            const rel = assetRelDir === '.' || assetRelDir === '' ? sibling.name : `${assetRelDir}/${sibling.name}`
            writeInsideTmp(tmpRoot, rel, readFileSync(path.join(assetDirAbs, sibling.name)))
          }
        } catch (err) {
          return earlyFail('asset-missing', listArtifacts(tmpRoot), `同目录测试文件拷贝失败：${err instanceof Error ? err.message : String(err)}`)
        }

        // —— ④ 应用变更（v0=文件替换对；逐对 containment 断言——逃逸/写失败=fail，不跑命令）——
        if (plan.patch !== undefined) {
          for (const pair of plan.patch) {
            try {
              writeInsideTmp(tmpRoot, pair.path, pair.content)
            } catch (err) {
              if (err instanceof PathEscapeError) {
                return earlyFail('path-escape', listArtifacts(tmpRoot), `补丁路径逃逸：${pair.path === '' ? '（空路径）' : pair.path}（候选 ${candidate.id}）`)
              }
              return earlyFail('patch-failed', listArtifacts(tmpRoot), `补丁应用失败 ${pair.path}：${err instanceof Error ? err.message : String(err)}`)
            }
          }
        }

        // —— ⑤ 跑冻结验收命令（shell 子进程，cwd=tmp，独立进程组；timeoutMs 到点杀整组）——
        const startedAt = clock()
        let stdoutRaw = ''
        let stderrRaw = ''
        let stdoutCapped = false
        let stderrCapped = false
        let exitCode: number | null = null
        let timedOut = false
        let spawnError: Error | undefined
        const child = spawn(plan.testCommand, {
          shell: true,
          cwd: tmpRoot,
          detached: true, // 独立进程组：超时杀整组（组长=shell，不留孙进程——adapters killpg 同精神）
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        await new Promise<void>((resolve) => {
          let settled = false
          let graceTimer: NodeJS.Timeout | undefined
          const finish = (): void => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            if (graceTimer !== undefined) clearTimeout(graceTimer)
            resolve()
          }
          const timer = setTimeout(() => {
            timedOut = true
            if (child.pid !== undefined) {
              try {
                process.kill(-child.pid, 'SIGKILL')
              } catch {
                child.kill('SIGKILL')
              }
            } else {
              child.kill('SIGKILL')
            }
            // close 事件兜底：正常杀后毫秒级到；fd 被 escaped 进程持有等病态面 2s 强收口
            graceTimer = setTimeout(finish, POST_KILL_GRACE_MS)
          }, plan.timeoutMs)
          child.stdout?.on('data', (chunk: Buffer) => {
            if (stdoutRaw.length < RAW_CAPTURE_CAP_CHARS) stdoutRaw += chunk.toString('utf8')
            else stdoutCapped = true
          })
          child.stderr?.on('data', (chunk: Buffer) => {
            if (stderrRaw.length < RAW_CAPTURE_CAP_CHARS) stderrRaw += chunk.toString('utf8')
            else stderrCapped = true
          })
          // close（非 exit）= 退出码已到且 stdio 冲刷完——摘要不丢尾
          child.once('close', (code: number | null) => {
            exitCode = code
            finish()
          })
          child.once('error', (err: Error) => {
            spawnError = err
            finish()
          })
        })
        const durationMs = Math.max(0, clock() - startedAt)
        const artifacts = listArtifacts(tmpRoot)

        if (timedOut) {
          return commandReport(false, 'timeout', null, true, durationMs, summarize(stdoutRaw, stdoutCapped), summarize(stderrRaw, stderrCapped), artifacts, `验收命令超时（${String(plan.timeoutMs)}ms）——进程组 SIGKILL，超时=fail 如实`)
        }
        if (spawnError !== undefined) {
          return commandReport(false, 'command-failed', null, false, durationMs, summarize(stdoutRaw, stdoutCapped), summarize(stderrRaw, stderrCapped), artifacts, `验收命令 spawn 失败：${spawnError.message}`)
        }
        const pass = exitCode === 0
        return commandReport(
          pass,
          pass ? null : 'command-failed',
          exitCode,
          false,
          durationMs,
          summarize(stdoutRaw, stdoutCapped),
          summarize(stderrRaw, stderrCapped),
          artifacts,
          pass ? undefined : `验收命令退出码 ${String(exitCode)}（非零=验收红，fail 如实）`,
        )
      } finally {
        // —— tmp 用后清理（证据已收进报告；清理失败如实上抛，不吞）——
        await rm(tmpRoot, { recursive: true, force: true })
      }
    },
  }
}

// ————————————————————————— CLI 链（一条命令进沙箱） —————————————————————————

/**
 * 落账的 verification 快照（拟稿形状，头注拟稿点）：GateEvidence 兼容面
 * （sandboxPass/blastRadiusOk——core gate 只读这三键位）+ sandbox 报告快照（人读/审计）。
 * blastRadiusOk 字面 false：影响面检查不在本刀，未证实即不声称（fail-closed）。
 */
export interface SandboxVerificationSnapshot {
  sandboxPass: boolean
  blastRadiusOk: false
  sandbox: {
    failReason: SandboxFailReason | null
    exitCode: number | null
    timedOut: boolean
    durationMs: number
    artifacts: readonly string[]
    stdout: string
    stderr: string
    note?: string
  }
}

/** CLI 链入参（bin.ts sandbox 子命令组装；测试直调同面） */
export interface SandboxChainOptions {
  candidateId: string
  /** 冻结验收命令（缺省 ''——无命令即 fail 如实，证据照样落账） */
  testCommand?: string
  /** 变更文件本地路径（内容=候选资产 tmp 内整文件替换——v0 单文件语义，头注拟稿点） */
  changeFile?: string
  /** 验收超时 ms（缺省 60_000，拟稿默认档） */
  timeoutMs?: number
  /** 生产资产根（candidate.asset_path 相对此根只读解析） */
  assetRoot: string
  /** 沙箱执行器（缺省 createSandboxRunner()；测试注入替身） */
  runner?: SandboxRunner
}

/** CLI 链结果（bin.ts 打印面；测试断言面） */
export interface SandboxChainResult {
  candidateId: string
  report: SandboxReport
  /** 本次是否发生 proposed→sandboxed 迁移（false=已在 sandboxed 重跑） */
  transitioned: boolean
  /** 落账的 verification 快照原样（store 读面回查应 deep-equal） */
  verification: SandboxVerificationSnapshot
}

/** store 行 → core 记录（verification unknown 收窄回 core 形状——e2e/evolve-guard 同款） */
function toCoreRecord(row: CandidateRow): CandidateRecord {
  return {
    id: row.id,
    asset_type: row.asset_type,
    asset_path: row.asset_path,
    version: row.version,
    diff_hash: row.diff_hash,
    blast_radius: row.blast_radius,
    verification: row.verification as CandidateRecord['verification'],
    parent_id: row.parent_id,
    status: row.status,
  }
}

/**
 * 沙箱链（一条命令进沙箱）：取候选 → runSandbox（临时目录法）→ updateVerification
 * 落证据（sandboxPass=report.pass）→ proposed 时迁移 sandboxed。
 *
 * 状态面（单一状态机纪律：边判定只走 core transitionCandidate，本函数不复制判定面）：
 *   - 前置判边（**先验后跑**——不白跑 60s 沙箱才发现落不了账）：sandboxed 之外的态先经
 *     core 判 proposed→sandboxed 机器边——draft（合法后继是 proposed）/ gated 及以后
 *     （证据只进沙箱阶段，F3-02 时序）在此如实拒（EVOLVE_REJECT，core 原报文）；
 *   - proposed：跑完先迁移 sandboxed（打开证据写窗）再落 verification；
 *   - sandboxed：重跑（updateVerification 覆盖=最新一次沙箱为准，窗口闸允许）。
 * 迁移=core 判边 + store 乐观锁（evolution-e2e daemonTransition 同款接力）。
 * 链内失败如实抛（CONFIG_INVALID/EVOLVE_REJECT 分类），bin.ts 捕获 exit 1；沙箱判定红
 * **不是链错误**（场景 C 档案面——exit 码语义见头注拟稿点）。
 */
export async function runCandidateSandbox(ledger: Ledger, opts: SandboxChainOptions): Promise<SandboxChainResult> {
  const row = ledger.getCandidate(opts.candidateId)
  if (row === undefined) {
    configInvalid('daemon/sandbox:candidate-unknown', `候选 ${opts.candidateId} 不在库（--candidate 回查失败）`)
  }
  // 前置判边（sandboxed 重跑免迁移；其余态 core 单一状态机判 proposed→sandboxed 边）
  const nextRecord = row.status === 'sandboxed' ? undefined : coreTransition(toCoreRecord(row), 'sandboxed')

  // plan 组装：--file=候选资产整文件替换对（v0 单文件语义，头注拟稿点）
  let patch: readonly PatchPair[] | undefined
  if (opts.changeFile !== undefined) {
    let content: string
    try {
      content = readFileSync(path.resolve(opts.changeFile), 'utf8')
    } catch (err) {
      configInvalid('daemon/sandbox:change-file-unreadable', `变更文件不可读 ${opts.changeFile}：${err instanceof Error ? err.message : String(err)}`)
    }
    patch = [{ path: row.asset_path, content }]
  }
  const runner = opts.runner ?? createSandboxRunner()
  const report = await runner.runSandbox(
    { id: row.id, asset_path: row.asset_path, diff_hash: row.diff_hash },
    {
      assetRoot: path.resolve(opts.assetRoot),
      ...(patch === undefined ? {} : { patch }),
      testCommand: opts.testCommand ?? '',
      timeoutMs: opts.timeoutMs ?? 60_000,
    },
  )

  // proposed→sandboxed（先迁后写=打开 updateVerification 窗口；store 乐观锁）
  let transitioned = false
  if (nextRecord !== undefined) {
    if (!ledger.transitionCandidate(row.id, row.status, nextRecord.status)) {
      configInvalid('daemon/sandbox:transition-lost', `候选 ${row.id} ${row.status}→${nextRecord.status} 乐观锁落库失败（期望当前值已过期——并发面，如实拒）`)
    }
    transitioned = true
  }

  // 证据落账：sandboxPass=report.pass；blastRadiusOk=false（影响面检查不在本刀，未证实即不声称）
  const verification: SandboxVerificationSnapshot = {
    sandboxPass: report.pass,
    blastRadiusOk: false,
    sandbox: {
      failReason: report.failReason,
      exitCode: report.exitCode,
      timedOut: report.timedOut,
      durationMs: report.durationMs,
      artifacts: report.artifacts,
      stdout: report.stdout,
      stderr: report.stderr,
      ...(report.note === undefined ? {} : { note: report.note }),
    },
  }
  if (!ledger.updateVerification(row.id, verification)) {
    configInvalid('daemon/sandbox:verification-lost', `候选 ${row.id} verification 落库失败（无此行=false——读面回查失败）`)
  }
  return { candidateId: row.id, report, transitioned, verification }
}

/** 链结果打印面（bin.ts 用：一行判定+明细行，日志即证据摘要） */
export function renderSandboxLines(result: SandboxChainResult, row: CandidateRow): string[] {
  const r = result.report
  return [
    `[sandbox] 候选 ${row.id}（${row.asset_path} · ${row.asset_type} · blast=${row.blast_radius}）——临时目录沙箱验证（20-§九 / 17-§三进化行；tmp 用后即删，生产零触碰）`,
    `[sandbox] 验收命令${r.failReason === 'command-missing' ? '：（无——fail 如实）' : '：已执行'}｜exit=${r.exitCode === null ? 'null' : String(r.exitCode)}｜timedOut=${String(r.timedOut)}｜duration=${String(r.durationMs)}ms`,
    `[sandbox] 判定：${r.pass ? 'PASS' : `FAIL（${r.failReason ?? '未知'}）`}${r.note === undefined ? '' : `——${r.note}`}`,
    `[sandbox] tmp 产物 ${String(r.artifacts.length)} 件${r.artifacts.length === 0 ? '' : `：${r.artifacts.join('、')}`}`,
    `[sandbox] 证据落账：updateVerification sandboxPass=${String(r.pass)}｜blastRadiusOk=false（影响面检查不在本刀，未证实即不声称——闸门面按 F3-03 定档）`,
    `[sandbox] 状态：${result.transitioned ? 'proposed→sandboxed（core 判边+store 乐观锁）' : 'sandboxed 重跑（verification 覆盖=最新一次沙箱为准）'}`,
  ]
}
