/**
 * 通知去重（105-刀B-5/F10；studio-dev-219）——同单同错误签名窗口聚合，防反馈环：
 * critical→制作人 @回→新 mention 意图→再告警 的环路由本面剪断（105 提案 §5.4-5）。
 *
 * 签名公式：`<事件名>:<单号>:<attempt>:<note 数字遮蔽>`——
 *   - STALL 连响（看门狗第 1/2/3 次…）note 只差计数与静默毫秒，数字遮蔽后同签名 →
 *     #alert 恰一条（S6 断言面）；attempt 变（咬合重派新誓）= 新签名再告（语义变更是新事件）；
 *   - GATE_PASS 每誓至多一次（收割终态幂等），note 数字遮蔽吞掉 tokens/cost 抖动；
 *   - DAILY_ALARM 同文同签（心跳哨兵单号恒同）→ 同日同因只告一次。
 *
 * 内存面：进程内 Map（通知去重是投递面语义，不入台账不落盘——重启即清=重启后首条
 * 重告，可接受：惊动预算按日计、重启是运维事件）；cap 上限逐出最旧（Map 插入序），
 * 防长跑膨胀。
 */

/** 默认容量（≈一周活跃单量级；超出逐出最旧——去重窗口是 best-effort 防环面） */
export const NOTIFY_DEDUP_CAP_DEFAULT = 512

export class NotifyDedup {
  private readonly seen = new Map<string, number>()
  private readonly cap: number
  private readonly now: () => number

  constructor(cap: number = NOTIFY_DEDUP_CAP_DEFAULT, now: () => number = (): number => Date.now()) {
    this.cap = cap
    this.now = now
  }

  /** 数字遮蔽签名（导出供测试断言：「第 1/2 次」与「第 2/2 次」同签名） */
  static signature(event: string, issue: string, attempt: number, note: string | undefined): string {
    return `${event}:${issue}:${attempt}:${(note ?? '').replace(/[0-9]+/g, '#')}`
  }

  /** 同签名在窗内 → false（应抑制）；首次/窗后 → true 并登记 */
  shouldSend(event: string, issue: string, attempt: number, note: string | undefined): boolean {
    const key = NotifyDedup.signature(event, issue, attempt, note)
    if (this.seen.has(key)) return false
    if (this.seen.size >= this.cap) {
      const oldest = this.seen.keys().next().value
      if (oldest !== undefined) this.seen.delete(oldest)
    }
    this.seen.set(key, this.now())
    return true
  }

  /** 观测面：当前登记数（测试/日志） */
  get size(): number {
    return this.seen.size
  }
}
