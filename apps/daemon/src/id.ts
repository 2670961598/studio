/**
 * id —— daemon 侧 ULID 生成器（events/work_records 主键）
 *
 * 依据：packages/store/test/ulid.ts 头注「生产侧 ULID 由 daemon 生成，store 只做格式校验」——
 * 本文件即生产侧实现（Crockford Base32，26 字符 = 48bit 时间戳 + 80bit crypto 随机；
 * contract UlidSchema：首字符 ≤ '7' 即 48bit 时间戳上限的数学推论，编码天然满足）。
 *
 * 单写入者顺序保证：daemon 单线程逐条生成（17-§3 设计判断），不做节点位。
 * 随机源 node:crypto（纯计算，非盘 IO）。
 */
import { randomBytes } from 'node:crypto'

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function encode(value: bigint, len: number): string {
  let out = ''
  for (let i = len - 1; i >= 0; i--) {
    out += ALPHABET[Number((value / 32n ** BigInt(i)) % 32n)]
  }
  return out
}

/** makeUlid(ts)：时间部分取 ts（epoch ms），随机部分 80bit crypto 随机；同 ms 不防乱序（单线程序） */
export function makeUlid(ts: number): string {
  return encode(BigInt(ts), 10) + encode(BigInt(`0x${randomBytes(10).toString('hex')}`), 16)
}
