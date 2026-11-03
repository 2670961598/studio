/**
 * serve/aiws-face —— .AIWS 员工工作区树装配面（根推导 / 建司建树 / 启动日志）
 *
 * 依据（实现单引用）：docs/43-§五+§十9（建司即建、per-company 不并树、增量归档不删）；
 *   docs/17-§2（主循环七相位——装配面不增删相位）；docs/17-§6（收割四要件——本件零判据变更）；
 *   docs/20-§十五.三（600 行阈：runtime.ts 拆件后原文件余量 ≥50，行为零漂移）。
 *
 * 边界：本件只做 .AIWS 根推导与启动期建树/日志；热重载增量同步仍在 runtime.ts 的 apply 段
 * （同一 aiwsRoot/aiwsClock 活引用由本件返回，避免双源）。
 */
import path from 'node:path'
import { AIWS_DIR, ensureAiwsTree } from '@studio-next/company'
import type { CompanySnapshot } from '@studio-next/contract'
import type { ServeConfig } from './config.ts'

export interface AiwsFace {
  /** .AIWS 根（热重载 apply 段复用同一值） */
  aiwsRoot: string
  /** 树操作时钟（Date 形；热重载 apply 段复用同一源） */
  aiwsClock: () => Date
}

/**
 * 装配 .AIWS 员工工作区树：根推导单一规则（显式 aiwsRoot > dirname(companyDir)/.AIWS >
 * <rootDir>/.AIWS）→ 建司即建/存量对账 → 启动日志。抛错＝启动失败（fail-closed，不半建）。
 */
export function wireAiwsFace(
  config: ServeConfig,
  snapshot: CompanySnapshot,
  clock: () => number,
  log: (line: string) => void,
): AiwsFace {
  const aiwsRoot = path.resolve(
    config.aiwsRoot ??
      (config.companyDir !== undefined
        ? path.join(path.dirname(path.resolve(config.companyDir)), AIWS_DIR)
        : path.join(path.resolve(config.rootDir), AIWS_DIR)),
  )
  const aiwsClock = (): Date => new Date(clock())
  const aiwsTree = ensureAiwsTree(aiwsRoot, snapshot.departments, snapshot.people, {
    slug: snapshot.slug,
    now: aiwsClock,
  })
  log(
    `[serve] .AIWS 员工工作区树：${aiwsRoot}（部门 ${snapshot.departments.length}、工位 ${aiwsTree.personDirs.length}` +
      `${aiwsTree.created > 0 ? `、新建 ${aiwsTree.created}` : ''}${aiwsTree.archived.length > 0 ? `、归档 ${aiwsTree.archived.length}` : ''}）——派发 cwd=<部门>/<工号>/tickets/<单号>/att<N>，家保留（docs/43-§五；per-company 不并树 §十9）`,
  )
  return { aiwsRoot, aiwsClock }
}
