/**
 * 字段映射 —— 业务字段名 ↔ Taiga 自定义属性名（docs/23-§二：公司目录声明映射，适配器翻译）。
 *
 * 与 yt 的 FieldTranslator 差异：Taiga 的 state 是**原生 status 字段**（状态集即平台真源），
 * 不需要映射；映射只服务自定义维（type/dept/level/lane…→ 自定义属性名）。
 * 故 opts.fields 整体可缺省——未映射的自定义维「读不见、写显式报错」，不静默。
 *
 * FieldProvisionMap.types 决定值编解码（缺省 string）：
 *   int → number（Taiga number 型属性）；date → ISO 字符串；其余 → 字符串
 */
import type { FieldProvisionMap } from '@studio-next/contract'
import { TaigaPlatformError } from './errors.ts'

const PORT_TYPES = ['string', 'int', 'enum', 'date', 'text'] as const
export type PortFieldType = (typeof PORT_TYPES)[number]
export { PORT_TYPES }

export class TaigaFieldMap {
  private readonly fields: Record<string, string>
  private readonly types: Record<string, PortFieldType>
  /** 流程状态全集（按流序；首元素=流程初态，建单落位依据，见 IssueCreate.initialState） */
  private readonly states: readonly string[]

  constructor(map?: FieldProvisionMap) {
    if (map === undefined) {
      this.fields = {}
      this.types = {}
      this.states = []
      return
    }
    if (typeof map !== 'object' || map === null || typeof map.fields !== 'object' || map.fields === null) {
      throw new TaigaPlatformError('CONFIG_INVALID', 'bad-field-map', 'FieldProvisionMap.fields 必须是对象')
    }
    for (const [business, platform] of Object.entries(map.fields)) {
      if (typeof platform !== 'string' || platform.trim() === '') {
        throw new TaigaPlatformError('CONFIG_INVALID', 'bad-field-map', `字段 ${business} 的平台名必须是非空字符串`)
      }
    }
    this.fields = { ...map.fields }
    this.types = {}
    for (const [business, t] of Object.entries(map.types ?? {})) {
      if (!(PORT_TYPES as readonly string[]).includes(t)) {
        throw new TaigaPlatformError('CONFIG_INVALID', 'bad-field-map', `字段 ${business} 的类型非法：${String(t)}`)
      }
      this.types[business] = t
    }
    this.states = [...map.states]
  }

  /** 流程初态（provision states[0]；无 provision/空 states → undefined=无声明，建单保持平台默认态） */
  initialState(): string | undefined {
    return this.states[0]
  }

  /** 业务名 → 平台名（未映射返回 undefined：读侧跳过、写侧报错由调用方定） */
  toPlatform(business: string): string | undefined {
    return this.fields[business]
  }

  /** 写路径：提供了未映射维 → 显式报错（不静默丢，对齐 yt） */
  requirePlatform(business: string): string {
    const platform = this.fields[business]
    if (platform === undefined) {
      throw new TaigaPlatformError(
        'CONFIG_INVALID',
        'unmapped-field',
        `业务字段 ${business} 未在字段映射中声明（FieldProvisionMap.fields）；Taiga state/title/description/assignee 原生，其余维需映射`,
      )
    }
    return platform
  }

  /** 编码业务值 → Taiga 属性值（int→number，其余字符串化） */
  encode(business: string, value: unknown): string | number {
    if (this.types[business] === 'int') {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new TaigaPlatformError('CONFIG_INVALID', 'bad-field-value', `${business} 必须是整数`)
      }
      return value
    }
    if (typeof value !== 'string') {
      throw new TaigaPlatformError('CONFIG_INVALID', 'bad-field-value', `${business} 必须是字符串`)
    }
    return value
  }

  /** 解码 Taiga 属性值 → 业务值（int 透传 number，其余 String()） */
  decode(business: string, raw: string): string | number {
    if (this.types[business] === 'int') {
      const n = Number(raw)
      if (Number.isSafeInteger(n)) return n
    }
    return raw
  }

  typeOf(business: string): PortFieldType {
    return this.types[business] ?? 'string'
  }
}
