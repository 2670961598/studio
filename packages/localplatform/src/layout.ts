/**
 * 根目录布局 —— LocalFile 平台的物理形态（docs/23-§一：单据=jsonl、状态=事件派生、评论=md 追加）
 *
 *   <root>/
 *     issues/<id>.jsonl          单据事件流（append-only：created / transitioned / field-set）
 *     issues/<id>.comments.md    评论（追加块，含署名行）
 *     activity.jsonl             全局活动流（append-only，id 单调递增 a-000001…）
 *     kb/**.md                   工作知识树（任意深度 .md）
 *     meta/fields.json           字段 schema + provision 落盘
 *     meta/guards.json           guard 规则落盘（仅落盘不执行，见 guards.ts 头注）
 *     meta/links.jsonl           单据间链接（append-only）
 *
 * 当前 state = 末次 transitioned 事件派生（append-only + 派生态，对齐 SQLite 台账哲学）；
 * 不采用 board/<state>/ 目录流转——git 历史可读性差（23-§一定调）。
 */
import { join } from 'node:path'

const ISSUES = 'issues'
const KB = 'kb'
const META = 'meta'

export function issuesDir(root: string): string {
  return join(root, ISSUES)
}

export function issuePath(root: string, id: string): string {
  return join(root, ISSUES, `${id}.jsonl`)
}

export function commentsPath(root: string, id: string): string {
  return join(root, ISSUES, `${id}.comments.md`)
}

export function activityPath(root: string): string {
  return join(root, 'activity.jsonl')
}

export function kbRoot(root: string): string {
  return join(root, KB)
}

export function metaDir(root: string): string {
  return join(root, META)
}

export function fieldsPath(root: string): string {
  return join(metaDir(root), 'fields.json')
}

export function guardsPath(root: string): string {
  return join(metaDir(root), 'guards.json')
}

export function linksPath(root: string): string {
  return join(metaDir(root), 'links.jsonl')
}
