/**
 * 测试用 ULID 生成器（Crockford Base32，26 字符 = 48bit 时间戳 + 80bit 随机）
 * 仅测试使用：生产侧 ULID 由 daemon 生成，store 只做格式校验（contract UlidSchema）。
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

/** makeUlid(ts)：时间部分取 ts（epoch ms），随机部分 80bit crypto 随机 */
export function makeUlid(ts: number): string {
  return encode(BigInt(ts), 10) + encode(BigInt(`0x${randomBytes(10).toString('hex')}`), 16)
}
