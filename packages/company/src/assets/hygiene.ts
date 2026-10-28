/**
 * assets/hygiene —— 包卫生面（路径逃逸/秘密与本机路径/可执行内容/挂载戳记）
 *
 * 依据链：
 *   - v2/06 §2.1（禁入物清单：秘密值/本机路径/安装脚本/宿主命令/自动执行钩子）、
 *     §2.2（字节惰性：取得到物化一律不执行）、§4.4（.studio-next.yaml 拆分：定义段进包、
 *     挂载戳记剥离）、§4.6（符号链接差异登记：当前按 51 E-1 全拒）、§九（强制失败出口）
 *   - v2/10 §4.7（SCH-PKG-04 挂载戳记四字段名单）、§4.8（SCH-PKG-05 偷渡通道表：脚本与解释器行、
 *     版本控制钩子、包管理生命周期、链接与嵌套归档）
 *   - v2/15 §四（秘密面：疑似即隔离、明示限制、不称「扫描证明绝无秘密」）
 *   - plan/05 IMPL-05-01/02
 *
 * 边界：本件只做只读扫描与文本变换，**不执行包内任何文件**；命中一律拒绝/隔离，不静默放行。
 * 秘密命中不回显匹配值（回显即二次泄漏——这是本件的硬纪律，测试同断言）。
 */
import { existsSync } from 'node:fs'
import { lstat, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

/** 扫描说明（报告必须原样携带：只声明「未发现疑似」） */
export const SECRET_SCAN_NOTE = '本扫描只声明「文本面未发现疑似秘密/本机路径」，不证明绝无秘密（v2/15 §四）'

/** 挂载戳记字段（SCH-PKG-04 四字段名单；传播前剥离，不进公开定义） */
export const MOUNT_STAMP_KEYS = ['created_at', 'last_validated_at', 'last_validation', 'framework_version'] as const
export type MountStampKey = (typeof MOUNT_STAMP_KEYS)[number]

/** 定义描述段字段（进定义部，随公开定义传播——v2/06 §4.4） */
export const STUDIO_NEXT_DEFINITION_KEYS = ['schema', 'template'] as const

/** 可执行内容扩展名（v2/10 §4.8 脚本与解释器行通道） */
export const CODE_EXTENSIONS = [
  '.mjs', '.cjs', '.js', '.jsx', '.ts', '.tsx', '.mts', '.cts',
  '.sh', '.bash', '.zsh', '.fish', '.py', '.rb', '.pl', '.php',
  '.ps1', '.bat', '.cmd', '.exe', '.dll', '.so', '.dylib', '.node',
  '.jar', '.wasm',
] as const

/** 版本控制元数据/本地产物目录（源仓出现即不合法——v2/06 §4.1 表 5） */
export const FORBIDDEN_TOP_LEVEL = ['.git', '.AIWS', '.studio-next'] as const

/** 包管理生命周期键（不得因解包触发安装脚本——v2/10 §4.8） */
export const PACKAGE_LIFECYCLE_SCRIPTS = [
  'preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prepublishOnly',
] as const

/** 疑似秘密模式（只判形态；命中即隔离，不尝试证明「绝无」） */
const SECRET_PATTERNS: readonly { name: string; re: RegExp }[] = [
  { name: 'private-key', re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/ },
  { name: 'openai-key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'github-token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/ },
  { name: 'github-pat', re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  {
    name: 'credential-assignment',
    re: /(?:api[_-]?key|secret|token|passwd|password|access[_-]?key)\s*[:=]\s*['"]?[A-Za-z0-9_\-]{16,}/i,
  },
]

/** 本机绝对路径模式（不得随包传播——v2/06 §2.1 / AGENTS §五.6） */
const LOCAL_PATH_PATTERNS: readonly { name: string; re: RegExp }[] = [
  { name: 'windows-drive', re: /\b[A-Za-z]:\\[^\s'"`]+/ },
  { name: 'file-url', re: /\bfile:\/\/[^\s'"`]+/ },
  { name: 'unix-home', re: /\/(?:Users|home|Volumes|private|root)\/[^\s'"`)]*/ },
  { name: 'opt-path', re: /\/opt\/[^\s'"`)]+/ },
  { name: 'tmp-path', re: /\/tmp\/[^\s'"`)]+/ },
]

/** 疑似命中（不回显匹配值——回显即二次泄漏） */
export interface SuspiciousHit {
  kind: 'secret' | 'local-path'
  pattern: string
  path: string
  line: number
}

/** 文本扫描（纯函数；逐行逐模式） */
export function scanSuspiciousText(text: string, filePath: string): SuspiciousHit[] {
  const hits: SuspiciousHit[] = []
  const lines = text.split('\n')
  for (const [index, line] of lines.entries()) {
    for (const p of SECRET_PATTERNS) {
      if (p.re.test(line)) hits.push({ kind: 'secret', pattern: p.name, path: filePath, line: index + 1 })
    }
    for (const p of LOCAL_PATH_PATTERNS) {
      if (p.re.test(line)) hits.push({ kind: 'local-path', pattern: p.name, path: filePath, line: index + 1 })
    }
  }
  return hits
}

/** 二进制/文本判定（含 NUL 视为二进制：不做秘密扫描，只做可执行位面判定） */
export function looksBinary(data: Uint8Array): boolean {
  const sample = data.subarray(0, Math.min(data.length, 8192))
  for (const byte of sample) if (byte === 0) return true
  return false
}

/** 解码为文本（仅用于扫描；解码失败返回 null） */
export function decodeText(data: Uint8Array): string | null {
  if (looksBinary(data)) return null
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch {
    return null
  }
}

/** 可执行文件魔数（ELF/MZ/Mach-O/Java class；无扩展名的二进制代码不得偷渡进定义部） */
function hasExecutableMagic(data: Uint8Array): boolean {
  if (data.length < 4) return false
  if (data[0] === 0x7f && data[1] === 0x45 && data[2] === 0x4c && data[3] === 0x46) return true // ELF
  if (data[0] === 0x4d && data[1] === 0x5a) return true // PE/MZ
  if (data[0] === 0xfe && data[1] === 0xed && data[2] === 0xfa && data[3] === 0xce) return true // Mach-O(be)
  if (data[0] === 0xcf && data[1] === 0xfa && data[2] === 0xed && data[3] === 0xfe) return true // Mach-O(le 64)
  if (data[0] === 0xca && data[1] === 0xfe && data[2] === 0xba && data[3] === 0xbe) return true // Java class
  return false
}

/** 是否解释器行/脚本/二进制可执行（v2/10 §4.8 脚本与解释器行通道；扩展名或 shebang 或魔数） */
export function isExecutableContent(relPath: string, data: Uint8Array): boolean {
  const ext = path.posix.extname(relPath).toLowerCase()
  if ((CODE_EXTENSIONS as readonly string[]).includes(ext)) return true
  if (hasExecutableMagic(data)) return true
  const text = decodeText(data)
  if (text !== null && (text.startsWith('#!') || /^\s*#!/m.test(text.slice(0, 512)))) return true
  return false
}

/** 树内条目（不递归符号链接；kind=symlink 由调用方按「全拒」处置——v2/06 §4.6） */
export interface TreeEntry {
  rel: string
  abs: string
  kind: 'file' | 'dir' | 'symlink'
}

/** 只读遍历（排序确定；不跟随符号链接） */
export async function walkTree(root: string, base = '', out: TreeEntry[] = []): Promise<TreeEntry[]> {
  const dir = base === '' ? root : path.join(root, base)
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const rel = base === '' ? entry.name : path.posix.join(base, entry.name)
    const abs = path.join(root, rel)
    if (entry.isSymbolicLink()) {
      out.push({ rel, abs, kind: 'symlink' })
    } else if (entry.isDirectory()) {
      out.push({ rel, abs, kind: 'dir' })
      await walkTree(root, rel, out)
    } else if (entry.isFile()) {
      out.push({ rel, abs, kind: 'file' })
    }
  }
  return out
}

/** 真实路径包含性（拒绝绝对路径/`..` 逃逸：解析后必须仍在根内） */
export function isInsideRoot(root: string, candidate: string): boolean {
  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(candidate)
  return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`)
}

/** 相对路径安全校验（拒绝绝对路径/盘符/`..` 段/空段） */
export function isSafeRelativePath(rel: string): boolean {
  if (rel === '' || path.isAbsolute(rel)) return false
  if (/^[A-Za-z]:/.test(rel) || rel.startsWith('/') || rel.startsWith('\\')) return false
  const segments = rel.split(/[\\/]/)
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

/** 目录存在且为真目录（符号链接不算——v2/06 §4.6 现状口径） */
export async function isRealDirectory(abs: string): Promise<boolean> {
  if (!existsSync(abs)) return false
  const info = await lstat(abs)
  return info.isDirectory() && !info.isSymbolicLink()
}

/** 挂载戳记拆分（SCH-PKG-04）：定义段保留，四类戳记剥离并登记 */
export interface StudioNextSplit {
  /** 剥离戳记后的定义段（YAML 文本；空对象给 null——不写空壳文件） */
  definition: Record<string, unknown>
  stripped: MountStampKey[]
  /** 未识别的键（既非定义段也非戳记——不静默写入，由调用方拒收） */
  unknownKeys: string[]
}

/** 拆分 `.studio-next.yaml`：解析失败抛错（由导入器归类为「定义部装不动」） */
export function splitStudioNextYaml(src: string): StudioNextSplit {
  const raw: unknown = parseYaml(src)
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('.studio-next.yaml 顶层须为对象')
  }
  const definition: Record<string, unknown> = {}
  const stripped: MountStampKey[] = []
  const unknownKeys: string[] = []
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if ((STUDIO_NEXT_DEFINITION_KEYS as readonly string[]).includes(key)) {
      definition[key] = value
    } else if ((MOUNT_STAMP_KEYS as readonly string[]).includes(key)) {
      stripped.push(key as MountStampKey)
    } else {
      unknownKeys.push(key)
    }
  }
  return { definition, stripped, unknownKeys }
}

/** 定义段重新序列化（无注释保留——物化只留定义语义；空对象返回 null） */
export function serializeStudioNextDefinition(definition: Record<string, unknown>): string | null {
  if (Object.keys(definition).length === 0) return null
  return stringifyYaml(definition)
}

/** 读文件字节（统一入口，避免各处重复 readFile 类型处理） */
export async function readBytes(abs: string): Promise<Buffer> {
  return readFile(abs)
}
