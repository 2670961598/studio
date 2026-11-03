/**
 * assembly/assets/boot —— daemon 启动相位：公司目录装载＋资产部生产接线（DOM-07）
 *
 * 依据（实现单引用）：
 *   - docs/17-§2（daemon 装配相位：公司目录装载先于运行栈构造；主循环七相位不增不减）；
 *   - docs/17-§6（资产/插件属执行前置面，不改变收割四要件判据）；
 *   - v2/05 §三 DOM-07（公司资产唯一权威=公司资产部；索引/绑定档案=投影）；
 *   - v2/06 §3.4（装载报告逐项明示；必备不可用＝具名二选一，缺省拒绝＝fail-closed）；
 *   - docs/43-§四（dependencies.yaml 属性绑定→插件安装/启用）＋§十-8（指纹幂等）。
 *
 * 职责（先拆后增，studio-dev-582）：把 run.ts 既有的「公司目录校验装载」段与新增的
 * 「资产部装载/插件同步」段收在同一装配件——run.ts 只留一行调用，尺寸不越 600 阈值；
 * 既有注释/空行逐行保留，不靠删空白或折注释腾行数（Q6 禁）。
 *
 * 行为边界：本件只读公司目录、写隔离插件根；不执行任何资产字节、不签发安装授权、
 * 不落 REC-ASSET-01 记录。失败＝调用方 onRefuse 收口（关台账/释放 writer lock）后抛
 * 「拒绝启动」形状错误（runServe 未捕获面 → 进程非零退出），不留半载态。
 */
import path from 'node:path'
import type { CompanySnapshot } from '@studio-next/contract'
import { PLUGINS_DIR, wireCompanyAssetsAtBoot } from './wire.ts'

/** 启动装载入参（runServe 装配面；onRefuse＝拒启收口回调，恰一次） */
export interface CompanyBootOptions {
  /** 公司目录（相对路径按 daemon 进程 cwd 解析；只读） */
  companyDir: string
  /** daemon 工位根（插件隔离根＝<rootDir>/plugins，与 company add 的 var/plugins 同源） */
  rootDir: string
  /** agent.yaml（可选）：执行器族来源；解析失败同样走拒启收口 */
  agentYaml?: string
  log: (line: string) => void
  onRefuse: () => void
}

/**
 * 启动相位装载：公司目录校验（不过＝拒启）→ 资产部装载/插件同步（DOM-07，fail-closed）。
 * 返回校验通过的快照；任一步失败先 onRefuse 收口再抛（不漏台账锁、不留半载态）。
 */
export async function loadCompanyAtBoot(opts: CompanyBootOptions): Promise<CompanySnapshot> {
  const companyDir = path.resolve(opts.companyDir)
  // 公司目录装载（校验不过拒绝启动——04-§九；daemon 只读快照不写目录）
  const { loadCompanyDirectory, readDirectoryFiles } = await import('@studio-next/company')
  const files = await readDirectoryFiles(companyDir)
  const mounted = loadCompanyDirectory(files)
  if (!mounted.ok) {
    opts.onRefuse()
    throw new Error(`公司目录校验不通过（拒绝启动）：\n${mounted.issues.map((i) => `  ${i.file}:${i.line} [${i.rule}] ${i.fix}`).join('\n')}`)
  }

  // 资产部生产接线（DOM-07；docs/17-§2 boot 装配相位；失败=拒启，v2/06 §3.4 fail-closed）
  await wireCompanyAssetsAtBoot({
    companyDir,
    pluginRoot: path.join(path.resolve(opts.rootDir), PLUGINS_DIR),
    log: opts.log,
    onRefuse: opts.onRefuse,
    ...(opts.agentYaml !== undefined ? { agentYaml: opts.agentYaml } : {}),
  })
  return mounted.snapshot
}
