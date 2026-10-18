/**
 * 链接面 —— 骨架（显式未实现，明报不静默）。
 *
 * 原因（docs/32 §四待核项）：**issue↔US 横向关联是否存在未实测**——Taiga 的原生
 * 关系是 epic→US、US→task、issue→US(generated_from_issue) 三种生成链，与端口的
 * parent-child/depends-on/relates-to 三型语义如何映射没有真机证据；links 能力
 * 定版前必须补测（docs/32 §四原话）。测清后本文件落地：
 *   link()     → 视映射可能是 external-reference / wiki link / 不支持明报
 *   children() → 视映射可能是 tasks 列表 / epic 成员 / 空集
 */
import { notImplemented } from './errors.ts'
import type { LinkType, TicketId } from '@studio-next/contract'

export async function link(_a: TicketId, _b: TicketId, _type: LinkType): Promise<void> {
  throw notImplemented('links', 'issue↔US/父子关联未实测（docs/32 §四待核项），定版需先真机补测 Taiga 关联模型')
}

export async function children(_id: TicketId): Promise<TicketId[]> {
  throw notImplemented('links', 'children 依赖同一关联模型（docs/32 §四待核项），与 link() 同批落地')
}
