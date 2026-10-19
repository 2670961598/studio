/**
 * init 脚手架 v0.1-M3（docs/16-§四：v0.1 验收口径 =「studio-next init 出模板公司并通过自检」）
 *
 * 链路：复制模板树 → 占位替换 → loadCompanyDirectory 自检 → 盖校验戳 → git init + 首次 commit。
 * 任一步失败抛 ClassifiedError(CONFIG_INVALID) 且撤除半成品（宁失败不半成品，04-§九）。
 *
 * 占位替换点全清单（只换「公司身份」，模板其余内容原样保留——04-§九.0 模板与建议不写死）：
 *   org-config.yaml：
 *     1. company.slug：example-corp → opts.slug（概览路由 /<slug>/，04-§七）
 *     2. company.name：示例公司 → opts.name ?? opts.slug（公司层提示词 L1 内容源之一）
 *   README.md：
 *     3. 标题「# 示例公司（公司自述）」→「# <name>（公司自述）」
 *   .studio-next.yaml：
 *     4. template: company-2-level → 模板目录 basename（默认即不变，替换兼作占位存在性断言）
 *     5. created_at: null → init 时间（ISO 8601）
 *     6. last_validated_at: null → 自检通过时间（先检后写，pass 不先盖）
 *     7. last_validation: null → pass（仅在自检真过后写入）
 *   留白：framework_version 仍为 null（v0.1 无 migrate 消费方，见文件头 TODO）
 *
 * 纪律：
 *   - 04-§九.5：daemon 是公司目录唯一写入者——init 是框架自带的引导写（bootstrap），
 *     之后的常规写入仍收口 daemon
 *   - 16-§二：git 走 simple-git（包 CLI，不碰仓内部格式，出事有 CLI 日志）；
 *     署名用 git 默认配置，不注入框架身份；机器无可用身份时 commit 失败如实上报
 *
 * TODO(分发)：bun build --compile 单文件分发时模板树需内嵌或随包落盘——当前按源码仓相对路径
 *   定位（packages/company/src → 仓根 templates/company-2-level），编译分发落地时在此改造。
 * TODO(迁移)：.studio-next.yaml 的 framework_version 暂留 null，migrate 落地时回填。
 * TODO(挂载壳)：readDirectoryFiles 目前跳过符号链接与二进制（一律 utf8）——公司目录 v0.1
 *   契约内无此形态，出现时随 04-§二 契约扩展一并处理。
 */
import { existsSync } from 'node:fs'
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { simpleGit } from 'simple-git'
import { configInvalid } from '@studio-next/contract'
import type { DirectoryIssue } from '@studio-next/contract'
import { loadCompanyDirectory } from './validator.ts'

/** init 入参（slug 必填；name 缺省用 slug；templateDir 缺省仓根 templates/company-2-level） */
export interface InitOptions {
  slug: string
  name?: string
  targetDir: string
  templateDir?: string
}

export interface InitResult {
  /** 公司目录绝对路径 */
  dir: string
  /** 首次 commit 哈希（全长） */
  gitCommit: string
}

/** slug 是概览路由 /<slug>/ 的 URL 片段（04-§七）：小写字母/数字/连字符，禁空白与路径分隔符 */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * 员工工作区树目录名（制作人 2026-10-20 口谕增补；docs/43-§五）：
 * `.AIWS/<部门路径>/<工号>/`——镜像 org-config 组织结构，员工在自己文件夹里做任意事。
 * 落在公司根目录（公司 git 目录/var 的同级，**不进公司 git 目录**）；与 .git/.DS_Store
 * 同款被内容指纹与文件监听排除（readDirectoryFiles 排除表——员工工作区不是公司配置面，
 * 写它不得触发热重载/批准指纹漂移）。
 */
export const AIWS_DIR = '.AIWS'

/** 默认模板：仓根 templates/company-2-level（16-§一 目录结构；分发内嵌问题见文件头 TODO） */
function defaultTemplateDir(): string {
  return fileURLToPath(new URL('../../../templates/company-2-level', import.meta.url))
}

function assertSlug(slug: string): void {
  if (!SLUG_RE.test(slug)) {
    configInvalid(
      'init/bad-slug',
      `slug 必须形如 my-corp（小写字母/数字/连字符，非空、两端不断字——它将作为概览路由 /<slug>/ 的 URL 片段），实得 ${JSON.stringify(slug)}`,
    )
  }
}

/** YAML 标量安全注入：含冒号/引号/井号等特殊字符时退 JSON 双引号（JSON 字符串是合法 YAML 双引号标量） */
const PLAIN_SAFE_RE = /^[A-Za-z0-9_\u4e00-\u9fff](?:[A-Za-z0-9_\u4e00-\u9fff -]*)?$/
function yamlScalar(value: string): string {
  return PLAIN_SAFE_RE.test(value) ? value : JSON.stringify(value)
}

/** 单点占位替换：必须恰好命中 1 次，模板漂移即抛（停手对齐模板，不改代码迁就） */
function replaceOnce(content: string, find: string, replace: string, what: string): string {
  const hits = content.split(find).length - 1
  if (hits !== 1) {
    configInvalid('init/template-placeholder-drift', `占位符「${what}」应在模板中恰好出现 1 次，实得 ${hits} 次（模板漂移：停手改模板对齐，不迁就代码）`)
  }
  return content.replace(find, replace)
}

function formatIssues(issues: DirectoryIssue[]): string {
  return issues.map((i) => `  ${i.file}:${i.line} [${i.rule}] ${i.fix}`).join('\n')
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 目录 → 内存文件映射（挂载壳：validator 零 IO 的补边，CLI / 后续 panel 共用）。
 * 键为相对根的 POSIX 风格路径；跳过 .git（版本库不是目录契约的一部分）、.DS_Store 与
 * .AIWS（员工工作区树——与 .git 同款排除：不是公司配置面，不进指纹/监听，docs/43-§五）。
 */
export async function readDirectoryFiles(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  const walk = async (dir: string, prefix: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true })
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === '.DS_Store' || entry.name === AIWS_DIR) continue
      const abs = path.join(dir, entry.name)
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) await walk(abs, rel)
      else if (entry.isFile()) files[rel] = await readFile(abs, 'utf8')
    }
  }
  await walk(root, '')
  return files
}

/**
 * 从模板生成公司目录并完成 git 首提（16-§四 v0.1 验收口径的引擎；CLI 薄壳在 apps/daemon bin）。
 * 成功返回目录与首提哈希；失败抛 ClassifiedError(CONFIG_INVALID)，本函数新建的目录整体撤除。
 */
export async function initCompany(opts: InitOptions): Promise<InitResult> {
  assertSlug(opts.slug)
  const name = opts.name ?? opts.slug
  if (name.trim() === '') configInvalid('init/bad-name', '公司名不能为空白')
  const targetDir = path.resolve(opts.targetDir)
  const templateDir = path.resolve(opts.templateDir ?? defaultTemplateDir())
  const templateName = path.basename(templateDir)

  // 模板健全性：占位替换涉及的契约文件必须齐备（04-§二）
  if (!existsSync(templateDir)) configInvalid('init/template-missing', `模板目录不存在：${templateDir}`)
  for (const file of ['org-config.yaml', 'README.md', '.studio-next.yaml']) {
    if (!existsSync(path.join(templateDir, file))) {
      configInvalid('init/template-missing', `模板缺契约文件 ${file}（04-§二 目录契约）：${templateDir}`)
    }
  }

  // 目标目录：已存在且非空即拒绝（宁失败不半成品：不向已有内容的目录混入公司文件）
  const targetExisted = existsSync(targetDir)
  if (targetExisted) {
    const entries = await readdir(targetDir)
    if (entries.length > 0) {
      configInvalid('init/target-not-empty', `目标目录已存在且非空：${targetDir}（请换 --dir 或清空后重试）`)
    }
  }

  try {
    if (!targetExisted) await mkdir(targetDir, { recursive: true })
    await cp(templateDir, targetDir, { recursive: true })

    const orgPath = path.join(targetDir, 'org-config.yaml')
    const readmePath = path.join(targetDir, 'README.md')
    const metaPath = path.join(targetDir, '.studio-next.yaml')

    let org = await readFile(orgPath, 'utf8')
    org = replaceOnce(org, 'slug: example-corp', `slug: ${opts.slug}`, 'org-config.yaml company.slug')
    org = replaceOnce(org, 'name: 示例公司', `name: ${yamlScalar(name)}`, 'org-config.yaml company.name')
    await writeFile(orgPath, org)

    let readme = await readFile(readmePath, 'utf8')
    readme = replaceOnce(readme, '# 示例公司（公司自述）', `# ${name}（公司自述）`, 'README.md 标题')
    await writeFile(readmePath, readme)

    const now = new Date().toISOString()
    let meta = await readFile(metaPath, 'utf8')
    meta = replaceOnce(meta, 'template: company-2-level', `template: ${yamlScalar(templateName)}`, '.studio-next.yaml template')
    meta = replaceOnce(meta, 'created_at: null', `created_at: ${yamlScalar(now)}`, '.studio-next.yaml created_at')
    await writeFile(metaPath, meta)

    // 自检：产物必须过目录校验（04-§二/§九），不过即抛——绝不让半成品落地成"已初始化"
    const mounted = loadCompanyDirectory(await readDirectoryFiles(targetDir))
    if (!mounted.ok) {
      configInvalid('init/self-check-failed', `产物未过目录自检（docs/04-§二 目录契约）：\n${formatIssues(mounted.issues)}`)
    }
    if (mounted.snapshot.slug !== opts.slug) {
      configInvalid('init/self-check-failed', `自检 slug 回读不符：期望 ${opts.slug}，实得 ${mounted.snapshot.slug}`)
    }

    // 盖校验戳：先检后写——last_validation: pass 只在真过后写入（模板注释：daemon 维护，init 属框架写入面）
    meta = replaceOnce(meta, 'last_validated_at: null', `last_validated_at: ${yamlScalar(now)}`, '.studio-next.yaml last_validated_at')
    meta = replaceOnce(meta, 'last_validation: null', 'last_validation: pass', '.studio-next.yaml last_validation')
    await writeFile(metaPath, meta)

    // git 首提：simple-git，署名走 git 默认配置（不注入框架身份）
    let commitHash: string
    try {
      const git = simpleGit(targetDir)
      await git.init()
      await git.add('.')
      const commit = await git.commit(`init: studio-next init 生成公司目录（slug=${opts.slug}，模板 ${templateName}）`)
      commitHash = commit.commit
    } catch (err) {
      configInvalid(
        'init/git-first-commit-failed',
        `git 首次提交失败（署名走 git 默认配置，请检查 user.name/user.email 或 GIT_AUTHOR_*/GIT_COMMITTER_* 环境变量）：${errText(err)}`,
      )
    }
    return { dir: targetDir, gitCommit: commitHash }
  } catch (err) {
    // 宁失败不半成品：新建目录整体撤除；预先存在的空目录清空内容后保留目录本身。
    // 清理失败不掩盖原始错误（catch 内只吞清理异常）。
    try {
      await rm(targetDir, { recursive: true, force: true })
      if (targetExisted) await mkdir(targetDir, { recursive: true })
    } catch {
      // 故意吞掉：原始失败原因优先上报
    }
    throw err
  }
}
