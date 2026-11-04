/**
 * deploy-state —— 部署状态文件（studio-dev-717 拆件；scripts/ops 边界登记）
 *
 * 为什么单独成件：deploy.mjs 受 600 行阈约束（717 加 state-first 顺序与回滚逻辑会顶格），
 * 状态 schema/读写是纯 IO 小面，抽件后 deploy.mjs 保持 <600；本件不 import 任何业务包，
 * 仅 node 标准库，测试经 deploy.mjs CLI 子进程覆盖（沿用 guardian.test.ts 先例，不跨包 import）。
 *
 * schema: studio-next/deploy-state/v1
 *   - active    : 部署已完成且 health ok（正常态）
 *   - deploying : 部署窗口内（state 已指向新 commit/tree，health pending）——guardian preflight
 *                 在窗口内必须看到「state 与部署树一致」，否则 fail-closed 拒绝起 daemon（717 事故根因）
 *   - failed    : 部署失败已回滚（state 与部署树一致，health 记录失败观测）——运维可见
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** 状态文件 schema 标识（与 708 首版一致，向后兼容） */
export const STATE_SCHEMA = 'studio-next/deploy-state/v1'

/** 状态面错误（code=2=preflight；deploy.mjs 主 catch 按 code 归一退出码） */
export class StateError extends Error {
  constructor(message) {
    super(message)
    this.name = 'StateError'
    this.code = 2
  }
}

/** 状态文件缺省路径（部署树外，避免污染 git 状态） */
export function statePathOf(opts, deploy) {
  if (typeof opts.state === 'string' && opts.state !== '') return path.resolve(opts.state)
  return `${deploy}.deploy-state.json`
}

/** 读状态（缺失=null；JSON 坏/fail-closed 抛 StateError） */
export function readState(statePath) {
  if (!existsSync(statePath)) return null
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'))
  } catch (err) {
    throw new StateError(`部署状态文件解析失败（${statePath}）：${err instanceof Error ? err.message : String(err)}`)
  }
}

/** 写状态（目录自动创建；原子性由调用方保证：窗口内先写新状态再重启） */
export function writeState(statePath, state) {
  mkdirSync(path.dirname(statePath), { recursive: true })
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

/** 状态公共字段（各 status 变体共用；deployedAt 由调用方显式给以保持确定性） */
export function baseState(fields) {
  return { schema: STATE_SCHEMA, ...fields }
}

/**
 * 部署失败回滚：把部署树 checkout 回「上一已验证树」并校验（717 事故修复：绝不留下
 * 「tree=新 commit / state=旧 commit」漂移——guardian preflight 会 fail-closed 死循环）。
 * 依赖由调用方注入（避免本件依赖 deploy.mjs，形成循环）。
 * @returns {{ok: boolean, commit: string, error?: string}}
 */
export function rollbackDeployTree({ repo, deploy, previousState, previousHead, inTree, verify, clean, entryCheck }) {
  const target = previousState !== null && typeof previousState.targetCommit === 'string' ? previousState.targetCommit : previousHead.commit
  try {
    inTree(deploy, target)
    verify(repo, deploy, target)
    clean(deploy, '部署树（回滚后）')
    if (entryCheck !== undefined) entryCheck(deploy)
    return { ok: true, commit: target }
  } catch (err) {
    return { ok: false, commit: target, error: err instanceof Error ? err.message : String(err) }
  }
}
