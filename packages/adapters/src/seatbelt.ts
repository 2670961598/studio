/**
 * seatbelt 写域圈定（DEV-29 原型 attempt3）——docs/43-§五 派发权限圈 ②
 *
 * 依据：
 *   - docs/43-§五 派发权限圈（阶梯）②：macOS seatbelt（sandbox-exec）配置文件落盘
 *     可写白名单=员工文件夹（+指定产出位）——「权限固定在文件夹内部」的机制化。
 *     本文件=该条的原型执行面：**profile 生成器（纯函数，随派发参数化）+ argv
 *     包装器**；适配器接线见 dsh.ts（DshAdapterOptions.seatbelt）。
 *   - docs/43-§五 单据证据位：每单 attempt 子目录同时是收割四要件断言面（docs/17-§6：
 *     终态 completed+输出非空+REPORT 落盘+闸门 exit=0）——写域圈定的最小白名单就是
 *     「该子目录 + 指定产出位」，本生成器按此收口。
 *   - docs/43-§八-3（v1.1 spike 面）：worker 子进程在 sandbox-exec 配置下运行，断言
 *     可写=员工文件夹、越界写被拒——「权限固定」的机制化证明。
 *
 * attempt3 处置（宰相审验打回② 4d91e6b2-cc3b-11f1，处置三选一取 (a)「删 strictRead
 * 形态」——宰相最推荐项）：
 *   - 打回事实链（两例同缺陷，均在宰相未沙箱环境 node spawnSync 直测复现）：
 *     · att1 v1 构造：读块置前 + 无过滤 `(deny file-read*)` + `file-read-data`
 *       字面例外 → strictRead 形态 apply 时 **SIGABRT**（status=null+signal=SIGABRT）；
 *     · att2 v2 构造：`(allow default)` 基线先行 + 根过滤 `(deny file-read*
 *       (subpath "/"))` + 读面全 `file-read*` op 通配零混编 → **仍 SIGABRT**——
 *       v2 已按假设修正仍崩，证伪「构造细节嫌疑」假设。
 *   - **结论（承宰相判词）**：「根域读收口」构造类本身在本机（macOS 26.3 arm64）
 *     属 SIGABRT 崩溃类——读白名单要表达「deny 一切换白名单再放行」，SBPL 里只有
 *     `(deny default)` 基线（aperion-shield 实测同崩类："fails as SIGABRT …
 *     unshippable"）与根过滤读 deny（att1/att2 两构造）两条路，全部已知崩——
 *     **读收口在 sandbox-exec 面上不可表达**，留待 Apple 支持或换机制（远期归
 *     docs/43-§五③ 完全沙箱）。
 *   - attempt3 落法（(a)）：**删除 strictRead 形态与读域参数**——生成器只出写域/
 *     网域两个 fail-closed 收口面，读域宽放（基线 `(allow default)` 覆盖读面，
 *     与平台 dsh 宿主对 worker 的既有圈定同形：写域收口、读宽放）。写域圈定=
 *     docs/43-§五② 规范正主，三形态（wide/nonet/egress）宰相侧 status=0 全过已验证。
 *   - **再引入纪律（红线）**：任何未来再引入读收口，必须附**未沙箱环境**（darwin
 *     真机）的形态 spawnSync apply 面复验输出（status=0 且无崩溃信号）——会话内
 *     已沙箱环境只能验编译面（65=文法错 / 71=编译过+嵌套 apply 拒 EPERM），崩不崩
 *     在 apply 面不可见（attempt1/2「会话绿/门禁崩」分裂面的教训）。
 *
 * 设计取舍（原型档，正式单再批）：
 *   - **fail-closed**：写域与网域一律 deny-by-default（`(deny file-write*)` /
 *     `(deny network*)`），白名单 subpath/endpoint 逐条放行——不是黑名单剔除。
 *   - **读域宽放**（attempt3 处置 (a)）：读面不收口（基线放行）——「读取按需放行」
 *     的强档在 sandbox-exec 面不可表达（见上崩溃类结论）；node/git/dsh 运行时读面
 *     （/usr、/opt/homebrew、$HOME 下 mise 等用户级分发位）在宽读下天然可用。
 *   - **网域**：回环 RPC（dsh 宿主 127.0.0.1:13800）与模型 API 出口全部参数化进
 *     profile（network-outbound 白名单）——写域圈定不触碰 network 面（file-write*
 *     与 network* 独立过滤，真机实证见 verification RPC 记录），RPC 连通只需网域
 *     白名单放行，与写域正交。
 *   - **应用层归属**：profile 由**未沙箱的派发方**（daemon/适配器宿主）生成并经
 *     `sandbox-exec -f` 应用到 worker 子进程——macOS 拒绝嵌套 sandbox_apply（真机实测
 *     EPERM exit 71，见验证记录），沙箱内的 worker 既无法逃逸也无法再沙箱，应用点必须
 *     在 daemon 层（适配器 spawn = daemon 进程内，天然满足）。
 *   - **零新依赖**：node:crypto 之外零引入（原型进主仓不动依赖面）。
 *
 * 已知局限（如实记，真机 macOS 26.3 实测）：
 *   - sandbox-exec 自 macOS 10.x 起标记 deprecated（仍随系统分发，本机实测可用）；
 *     长期 confinement 路线归 docs/43-§五 ③（完全沙箱，远期）。
 *   - seatbelt profile 无官方完整文法文档，`(subpath …)`/`(literal …)` 为工程惯用面
 *     （Chromium/WebKit 同源用法），语义以真机验证为准。
 *   - **网域 host 字面量仅接受 `*` 与 `localhost`**（带端口）：IP 字面量
 *     （`127.0.0.1:13800`）与域名（`example.com:443`）在 `remote tcp/ip` 过滤器里
 *     一律编译错 `host must be * or localhost in network address`。落法：
 *     ① 回环端点归一为 `localhost:<port>`（socket 目的地址等价）；② 非回环 host
 *     **生成期显式拒绝**（fail-closed，不静默放宽成 `*:port` 通配——通配档位语义
 *     由派发方显式传 `host:'*'` 自担）；③ 模型 API 等远程出口按域名收口**不可表达**
 *     ——方案=daemon 侧本地代理（worker 出口只留 localhost:<proxyPort>，代理层做
 *     域名白名单），或显式 `*:443` 端口档（宽 host），详见 deliverables RPC 评估。
 *   - `(subpath …)` 过滤按内核解析路径匹配，不做符号链接归一化（Chromium 沙箱文档
 *     同款已知限制）——写域的强归一化归 ③ 完全沙箱档。
 */
import { randomUUID } from 'node:crypto'

/** sandbox-exec 系统路径（macOS 唯一分发位；路径写死防 PATH 劫持——env 白名单同精神） */
export const SEATBELT_BIN = '/usr/bin/sandbox-exec'

/** 网域端点（host:port 字面量；回环 RPC 与模型 API 出口共用形状） */
export interface SeatbeltEndpoint {
  host: string
  port: number
}

/**
 * dsh 宿主 RPC 缺省端点（dsh web/宿主常驻 :13800——本缺省值即「先行接线」面对齐的
 * 回环端点，正式单随宿主形态定稿再批）。host 用 IP 字面量（调用方视角=目的地址）；
 * profile 落文时归一为 localhost:port（macOS remote 过滤器只认 localhost 与通配星号，
 * 见头注局限）。
 */
export const DSH_HOST_RPC_DEFAULT: readonly SeatbeltEndpoint[] = [{ host: '127.0.0.1', port: 13800 }]

/** profile 生成入参（随派发参数化：写域/网域/标签全部来自派发上下文） */
export interface SeatbeltProfileParams {
  /**
   * 写域白名单根（**绝对路径**；deny-by-default 之外的唯一可写面）。docs/43-§五②：
   * 员工 tickets 单据子目录（TaskBrief.workspace）+ 指定产出位（同子目录内 deliverables/
   * REPORT.md 由子目录覆盖；跨目录产出位由派发方追加）+ dsh 运行面（DSH_HOME 重定向
   * 落子目录内；见 dsh.ts DshSeatbeltOptions.dshHomeRedirect）。
   */
  writeRoots: readonly string[]
  /** 回环 RPC 白名单（缺省=DSH_HOST_RPC_DEFAULT；空数组=禁回环 RPC） */
  localRpcEndpoints?: readonly SeatbeltEndpoint[]
  /** 远程 TCP 出口白名单（模型 API egress；缺省空=禁远程出口——本机 spike 档） */
  outboundTcp?: readonly SeatbeltEndpoint[]
  /** profile 头注标签（单号/attempt/工号——证据可读性；可为 undefined） */
  label?: string
}

/**
 * 生成 worker seatbelt profile（SBPL 文本）——纯函数：同参数同文本（可测、可落账、
 * 可 diff 审计），参数随派发（单号→写域根→profile 全文）。
 *
 * 形态（fail-closed；**顺序即语义**——SBPL 求值=最后匹配规则胜，基线必须置首、
 * 收口与白名单按「deny → 再放行」栈在其后）：
 *   1. `(version 1)` 头 + `;;` 头注标签
 *   2. `(allow default)` 基线**先行**（mach/process 面 + 读面——attempt3 处置 (a)：
 *      读域宽放，读收口构造类=SIGABRT 崩溃类已删，见头注）
 *   3. `(deny file-write*)` + writeRoots 逐条 `(allow file-write* (subpath …))`
 *   4. `(deny network*)` + localRpcEndpoints/outboundTcp 逐条
 *      `(allow network-outbound (remote tcp "localhost:port"/"*:port"))`（host 字面量
 *      约束与归一见头注局限+sbEndpoint）
 */
export function buildWorkerSeatbeltProfile(params: SeatbeltProfileParams): string {
  const lines: string[] = []
  lines.push(`;; studio-next worker seatbelt profile — docs/43-§五权限圈②（DEV-29 原型 attempt3）`)
  if (params.label !== undefined) lines.push(`;; dispatch: ${params.label}`)
  lines.push('(version 1)')
  lines.push(';; —— 基线先行（最后匹配规则胜：未收口面放行——mach/process/读面宽放，attempt3 处置 (a)）——')
  lines.push('(allow default)')
  lines.push(';; —— 写域收口（file-write* deny-by-default，白名单=员工单据子目录+指定产出位）——')
  lines.push('(deny file-write*)')
  for (const root of params.writeRoots) {
    if (root === '') continue
    lines.push(`(allow file-write* (subpath ${sbPath(root)}))`)
  }
  lines.push(';; —— 网域收口（network* deny-by-default，白名单=回环宿主 RPC+模型 API 出口）——')
  lines.push('(deny network*)')
  const rpc = params.localRpcEndpoints ?? DSH_HOST_RPC_DEFAULT
  const egress = params.outboundTcp ?? []
  for (const ep of rpc) {
    lines.push(`(allow network-outbound (remote tcp ${sbEndpoint(ep)}))`)
  }
  for (const ep of egress) {
    lines.push(`(allow network-outbound (remote tcp ${sbEndpoint(ep)}))`)
  }
  return `${lines.join('\n')}\n`
}

/**
 * 包装 worker argv：`sandbox-exec -f <profile> -- <原 argv…>`。
 * `--` 分隔符防原 argv 首参以 `-` 开头被 sandbox-exec 当旗标（与 dsh 任务串同款手法）。
 */
export function seatbeltArgv(profilePath: string, childArgv: readonly string[]): string[] {
  return [SEATBELT_BIN, '-f', profilePath, '--', ...childArgv]
}

/** profile 落盘文件名（每 attempt 唯一；落子目录 .seatbelt/ 下=证据随单走） */
export function seatbeltProfileFileName(): string {
  return `worker-${randomUUID()}.sbpl`
}

// ---------------------------------------------------------------------------
// 内部工具（纯函数）
// ---------------------------------------------------------------------------

/** SBPL 字符串字面量转义（双引号/反斜杠；防 path 注入 profile 文法） */
function sbQuote(s: string): string {
  return `"${s.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

/** subpath 字面量：绝对路径直接引用（subpath 已含递归语义，无需尾斜杠） */
function sbPath(p: string): string {
  return sbQuote(p)
}

/** endpoint 字面量："host:port"（sandbox network remote 形态）——host 归一/校验见 sbEndpoint */
function sbEndpoint(ep: SeatbeltEndpoint): string {
  const host =
    ep.host === '127.0.0.1' || ep.host === '::1' || ep.host === 'localhost'
      ? 'localhost'
      : ep.host
  if (host !== 'localhost' && host !== '*') {
    // macOS 26.3 实测：remote 过滤器 host 字面量仅接受 * / localhost（IP/域名编译错
    // exit 65）。生成期显式拒绝（fail-closed）——绝不静默放宽成 * 通配（宽档由派发
    // 方显式点名 host:'*' 自担）；按域名收口的出口方案=daemon 侧本地代理（见 RPC 评估）
    throw new Error(
      `seatbelt: 网域端点 host 仅接受回环(localhost/127.0.0.1/::1，归一为 localhost)或通配 '*'；` +
        `按域名/IP 收口出口在 macOS remote 过滤器不可表达（编译错），得到的是 "${ep.host}:${String(ep.port)}"——` +
        `远程出口走 daemon 侧本地代理（localhost:<proxyPort>）或显式 '*:${String(ep.port)}' 端口档`,
    )
  }
  return sbQuote(`${host}:${String(ep.port)}`)
}
