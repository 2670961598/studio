/**
 * assembly/roles/loader —— 公司 L2.5 角色包装载/校验（studio-dev-724 / 计划 726）
 *
 * 读面（只读公司目录；DOM-01 权威）：`company/prompts/roles/<class>.md` 6 类模板 +
 * `company/prompts/roles/cards/<工号>.md` 岗位卡（YAML front-matter 子集）。
 * 纯逻辑（类型/回退文本/类推断）在 `@studio-next/prompt`；本件只做 IO+严格校验——
 * 存在即校验（空/超长/未闭合 front-matter/层定界标记走私=抛错，不静默），缺省目录=空集合
 * （调用方按未配置回退默认类边界，不伪造）。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import {
  ROLE_CLASSES,
  ROLE_CLASS_LABELS,
  type RoleCard,
  type RoleClass,
  type RolePack,
} from '@studio-next/prompt'

const CLASS_MAX_CHARS = 8000
const CARD_MAX_CHARS = 6000
const ANY_LAYER_MARKER = /<!--\s*LAYER:L\d(?:\.\d)?:(?:BEGIN|END)/

export interface RolePacks {
  readonly templates: ReadonlyMap<RoleClass, string>
  readonly cards: ReadonlyMap<string, RoleCard>
  rolePackFor(personId: string, roleClassHint?: string): RolePack | undefined
}

function fail(message: string): never {
  throw new Error(`roles/loader: ${message}`)
}

function parseFrontMatter(text: string): { meta: Record<string, string>; body: string } {
  if (!text.startsWith('---\n')) return { meta: {}, body: text }
  const end = text.indexOf('\n---\n', 4)
  if (end < 0) fail('岗位卡 front-matter 未闭合（缺结尾 ---）')
  const meta: Record<string, string> = {}
  for (const line of text.slice(4, end).split('\n')) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    let value = line.slice(idx + 1).trim()
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    if (key !== '' && value !== '') meta[key] = value
  }
  return { meta, body: text.slice(end + 5) }
}

function readRoleClass(value: string | undefined): RoleClass | undefined {
  return value !== undefined && (ROLE_CLASSES as readonly string[]).includes(value) ? (value as RoleClass) : undefined
}

export function loadRoleTemplates(companyDir: string): Map<RoleClass, string> {
  const dir = path.join(companyDir, 'prompts', 'roles')
  const out = new Map<RoleClass, string>()
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md')) continue
    const roleClass = readRoleClass(name.slice(0, -3))
    if (roleClass === undefined) continue
    const text = readFileSync(path.join(dir, name), 'utf8').trim()
    if (text === '') fail(`角色类模板为空：${name}`)
    if (text.length > CLASS_MAX_CHARS) fail(`角色类模板超长（${text.length} > ${CLASS_MAX_CHARS}）：${name}`)
    if (ANY_LAYER_MARKER.test(text)) fail(`角色类模板含层定界标记（走私）：${name}`)
    out.set(roleClass, text)
  }
  return out
}

export function loadRoleCards(companyDir: string): Map<string, RoleCard> {
  const dir = path.join(companyDir, 'prompts', 'roles', 'cards')
  const out = new Map<string, RoleCard>()
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md')) continue
    const personId = name.slice(0, -3)
    if (personId === '' || personId.includes('/')) fail(`岗位卡文件名非法：${name}`)
    const text = readFileSync(path.join(dir, name), 'utf8')
    if (text.length > CARD_MAX_CHARS) fail(`岗位卡超长（${text.length} > ${CARD_MAX_CHARS}）：${name}`)
    const { meta, body } = parseFrontMatter(text)
    const roleClass = readRoleClass(meta['roleClass'])
    if (roleClass === undefined) fail(`岗位卡 roleClass 非法/缺失（${personId}）：须为 ${ROLE_CLASSES.join('/')}`)
    if (ANY_LAYER_MARKER.test(body)) fail(`岗位卡正文含层定界标记（走私）：${name}`)
    if (body.trim() === '') fail(`岗位卡正文为空：${name}`)
    const version = Number(meta['version'] ?? '1')
    out.set(personId, {
      personId,
      roleClass,
      title: meta['title'] ?? personId,
      mission: meta['mission'] ?? '',
      body: body.trim(),
      version: Number.isInteger(version) && version > 0 ? version : 1,
    })
  }
  return out
}

export function loadRolePacks(companyDir: string): RolePacks {
  const templates = loadRoleTemplates(companyDir)
  const cards = loadRoleCards(companyDir)
  // F1 fail-closed：每张卡声明的 roleClass 必须有对应模板——缺模板即拒（不得静默跳过/跨类顶替）。
  // 仅当**整个 roles 目录/配置缺省**（templates 与 cards 均空）才走诚实默认。
  if (cards.size > 0) {
    for (const card of cards.values()) {
      if (!templates.has(card.roleClass)) {
        fail(
          `岗位卡 ${card.personId} 声明的 roleClass=${card.roleClass} 缺少类模板 ${card.roleClass}.md` +
            `（期望 ${path.join(companyDir, 'prompts', 'roles', `${card.roleClass}.md`)}）——缺模板 fail-closed，不得跨类顶替`,
        )
      }
    }
  }
  return {
    templates,
    cards,
    /** 类模板与卡类必须同源同类；不做 hint 跨类回退（studio-dev-724 F1）。 */
    rolePackFor(personId: string): RolePack | undefined {
      const card = cards.get(personId)
      if (card === undefined) return undefined
      const classText = templates.get(card.roleClass)
      if (classText === undefined) return undefined // 正常不可达（load 已 fail-closed）
      return { roleClass: card.roleClass, roleLabel: ROLE_CLASS_LABELS[card.roleClass], classText, card }
    },
  }
}
