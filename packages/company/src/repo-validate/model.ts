/**
 * repo-validate/model —— 判定器规则号/常量/结果形状（docs/51-§一..§七）
 *
 * 依据（实现单引用）：docs/51（公司仓库规范正文）；docs/17-§2（主循环相位——判定器不增删相位）；
 *   docs/17-§6（收割四要件——判定器零判据变更）；docs/20-§十五.三（600 行阈：repo-validate.ts
 *   拆件后原文件余量 ≥50，行为零漂移）。
 *
 * 边界：本件只放规则号/常量/结果形状（纯编译期与常量面）；walk/闸/判定入口仍在 repo-validate.ts。
 */
import type { CompanySnapshot } from '@studio-next/contract'

// ————————————————————————— 0. 规则号/常量（docs/51-§一..§六） —————————————————————————

export type RepoRuleId =
  | 'A-1' | 'A-2' | 'A-3' | 'A-4' | 'A-5'
  | 'B-1' | 'B-2' | 'B-3' | 'B-4' | 'B-5' | 'B-6'
  | 'C-1' | 'C-2' | 'C-3' | 'C-4' | 'C-5' | 'C-6' | 'C-7' | 'C-8'
  | 'D-1' | 'D-2' | 'D-3' | 'D-4'
  | 'E-1' | 'E-2' | 'E-3' | 'E-4'

/** 判定面：source=源仓（含 git-url 的克隆产物）；product=导入镜像+重建后的产物（锚豁免） */
export type RepoFace = 'source' | 'product'

/**
 * 顶层封闭集（docs/51-§二 枚举 + 框架自管两员 R2）：
 *   - 文件位：org-config.yaml / charter.md / dependencies.yaml / .gitignore / README.md /
 *     .studio-next.yaml（docs/44-§v1.1 挂载元信息随行）
 *   - 目录位：charter/ departments/ prompts/ docs/ plugins/ reports/（B-4 output 锚定的
 *     产出根；templates 与 DEV-27 允许集先例）
 */
export const CLOSED_TOP_FILES: readonly string[] = [
  'org-config.yaml', 'charter.md', 'dependencies.yaml', '.gitignore', 'README.md', '.studio-next.yaml',
]
export const CLOSED_TOP_DIRS: readonly string[] = ['charter', 'departments', 'prompts', 'docs', 'plugins', 'reports']

/** 锚目录与员工工作区（A-4/A-5/E-3 面语义见头注 R7） */
export const ANCHOR_DIR = '.studio-next'
export const AIWS_DIR = '.AIWS'

/** walk 排除面：.git=版本库非契约（A-3，克隆/解包同理跳过）；.DS_Store=系统杂音（与 DEV-27 同口径） */
export const WALK_SKIP_NAMES: readonly string[] = ['.git', '.DS_Store']

/** E-4 资源护栏（docs/51-§六：实现期参数，拟稿可调——常量单源） */
export const REPO_SINGLE_FILE_MAX_BYTES = 8 * 1024 * 1024
export const REPO_FILE_COUNT_MAX = 5000

/** B-1 slug 语法域（docs/51-§三：小写字母/数字/连字符，3-64 字符，两端不断字） */
export const DOCS51_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/

/** R3：工号/部门段=slug 语法形状域（大小写/中文随全司惯例：AGENT-1 / 工程部 均合法） */
export const ID_SEGMENT_RE = /^[A-Za-z0-9\u4e00-\u9fff]+(?:-[A-Za-z0-9\u4e00-\u9fff]+)*$/

/** R5：semver 三元组（x.y.z） */
export const SEMVER_RE = /^\d+\.\d+\.\d+$/

export const ORG_CONFIG_FILE = 'org-config.yaml'
export const DEPENDENCIES_FILE = 'dependencies.yaml'
export const TARBALL_RE = /\.(?:tar|tar\.gz|tgz|tar\.bz2|tar\.xz)$/i

// ————————————————————————— 1. 结果形状（docs/51-§七 输出契约） —————————————————————————

/** 单条违规：规则号 + 文件 + 位置（行号 L<n> 或键路径）+ 违规描述 + 修复建议 */
export interface RepoViolation {
  rule: RepoRuleId
  file: string
  location: string
  problem: string
  fix: string
  /** 共享核内层规则号（org-config/missing-field:company.slug 等——DEV-27 既有断言面） */
  via?: string
  /** DEV-27 结构闸别名（import/unknown-entry、import/aiws-present、import/anchor-present 等——新旧规则号共存，测试与运维双面可读） */
  alias?: string
}

/** 合法但须明示的面（D-2 冲突警示；缺 meta 的迁移期提示等——不阻断） */
export interface RepoWarning {
  rule: string
  file: string
  location: string
  problem: string
}

/** PASS 摘要（docs/51-§七：公司/部门/人数/jobs/插件/能力缺失面） */
export interface RepoValidateSummary {
  name: string
  slug: string
  level: number
  departments: number
  people: number
  jobs: number
  plugins: number
  platform: string
  /** D-3 能力缺失面（绑定插件无仓内源——合法，安装面另行处理） */
  capabilityMissing: { name: string; required: string[]; detail: string }[]
  /** D-2 约束并集无解面（冲突警示——合法不装错） */
  conflicts: { name: string; required: string[]; detail: string }[]
}

export interface RepoValidateResult {
  ok: boolean
  face: RepoFace
  violations: RepoViolation[]
  warnings: RepoWarning[]
  /** --allow-extra 豁免留痕（A-1 封闭集外路径逐条列出，不豁免其他组） */
  exempted: string[]
  summary?: RepoValidateSummary
  /** org 面合法即给出（导入流/摘要共用同一快照——单一事实源） */
  snapshot?: CompanySnapshot
}

export interface RepoValidateOptions {
  /** 缺省 source；DEV-27 产物面跑 product（锚豁免） */
  face?: RepoFace
  /** --allow-extra：A-1 封闭集外路径豁免并留痕（不豁免 B/C/D/E） */
  allowExtra?: boolean
}
