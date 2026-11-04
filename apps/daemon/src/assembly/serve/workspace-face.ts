/**
 * serve/workspace-face —— 常驻角色工作目录树装配面（studio-dev-723 / 计划 725；docs/90-§八）
 *
 * 根推导单一规则（B 默认）：`dirname(companyDir)/workspaces`（与 company/ 平级、**不进 git**）；
 * 无 companyDir（demo）=`<rootDir>/workspaces`。启动期建树/增量同步＋启动日志；热重载 apply
 * 段复用同一 workspaceRoot/workspaceClock 活引用（不双源）。
 *
 * 边界：只建目录/写 agent.md/memory.md 模板；不写 secrets/证据/台账；不碰 company/ git。
 */
import path from 'node:path'
import { WORKSPACES_DIR, ensureWorkspaceTree } from '@studio-next/company'
import type { CompanySnapshot } from '@studio-next/contract'
import type { ServeConfig } from './config.ts'

export interface WorkspaceFace {
  readonly workspaceRoot: string
  readonly workspaceClock: () => Date
}

export function wireWorkspaceFace(
  config: ServeConfig,
  snapshot: CompanySnapshot,
  clock: () => number,
  log: (line: string) => void,
): WorkspaceFace {
  // 根推导（单一规则）：
  //   - 标准公司目录 `<companyRoot>/company` → `<companyRoot>/workspaces`（制作人批 B 默认）；
  //   - 非标准布局（测试/多司同父目录）→ `<companyRoot>/workspaces/<slug>`，避免多司并树；
  //   - 无 companyDir（demo）→ `<rootDir>/workspaces/<slug>`。
  const companyDirAbs = config.companyDir !== undefined ? path.resolve(config.companyDir) : undefined
  const workspaceBase =
    companyDirAbs !== undefined
      ? path.join(path.dirname(companyDirAbs), WORKSPACES_DIR)
      : path.join(path.resolve(config.rootDir), WORKSPACES_DIR)
  const workspaceRoot = path.resolve(
    companyDirAbs !== undefined && path.basename(companyDirAbs) === 'company'
      ? workspaceBase
      : path.join(workspaceBase, snapshot.slug),
  )
  const workspaceClock = (): Date => new Date(clock())
  const tree = ensureWorkspaceTree(
    workspaceRoot,
    snapshot.departments.map((dept) => ({ path: dept.path, leader: dept.leader })),
    snapshot.people.map((person) => ({
      id: person.id,
      dept: person.dept,
      ...(person.role !== undefined ? { role: person.role } : {}),
      ...(person.name !== undefined ? { name: person.name } : {}),
    })),
    { slug: snapshot.slug, now: workspaceClock },
  )
  log(
    `[serve] 工作目录树（workspaces，常驻角色家；不进 git）：${workspaceRoot}（部门 ${snapshot.departments.length}、角色 ${tree.personDirs.length}` +
      `${tree.created > 0 ? `、新建 ${tree.created}` : ''}${tree.archived.length > 0 ? `、归档 ${tree.archived.length}` : ''}）——agent.md/memory.md/docs/work；.AIWS=单次执行证据沙盒（tickets/att<N>）`,
  )
  return { workspaceRoot, workspaceClock }
}
