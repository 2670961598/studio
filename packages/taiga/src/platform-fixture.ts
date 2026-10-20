/**
 * platform-fixture —— 平台工厂与断言（口径对齐 localplatform/yt testutil）。
 *
 * 从 testutil.ts 上移的尾部工具段（尺寸基线清偿，docs/20-§十五.三；行为零变更）：
 * TEST_BASE_URL / TEST_PASSWORD_AUTH / TEST_FIELDS（默认测试映射——公司目录声明样例，
 * state/assignee 原生不需要映射）/ makePlatform（FakeTaiga→FlowPlatform 装配）/
 * expectTaigaReject（异步断言：reject TaigaPlatformError 且 category/subcause 匹配）。
 */
import { expect } from 'vitest'
import type { ErrorCategory, FieldProvisionMap, FlowPlatform } from '@studio-next/contract'
import { createTaigaPlatform, TaigaPlatformError } from './index.ts'
import type { FakeTaiga } from './testutil.ts'

export const TEST_BASE_URL = 'http://taiga.test'
/** 测试凭据（与 testutil 认证面 USERNAME/PASSWORD 同值——两处假值对，改则同改） */
export const TEST_PASSWORD_AUTH = { type: 'password' as const, username: 'svc-agent', password: 'fake-password' }

/** 默认测试映射（公司目录声明样例；state/assignee 原生不需要映射） */
export const TEST_FIELDS: FieldProvisionMap = {
  fields: { type: '类型', dept: '部门', level: '等级', lane: '泳道' },
  types: { level: 'int' as const },
  states: ['New', 'In progress', 'Done'],
  stateFlow: { New: ['In progress'], 'In progress': ['Done'] },
}

export function makePlatform(
  fake: FakeTaiga,
  opts?: { pageSize?: number; fields?: FieldProvisionMap | undefined; entity?: 'userstory' | 'issue' },
): FlowPlatform {
  return createTaigaPlatform({
    baseUrl: TEST_BASE_URL,
    project: 'probe-co',
    auth: TEST_PASSWORD_AUTH,
    fields: opts?.fields ?? TEST_FIELDS,
    ...(opts?.entity === undefined ? {} : { entity: opts.entity }),
    ...(opts?.pageSize === undefined ? {} : { pageSize: opts.pageSize }),
    fetch: fake.fetch,
  })
}

/** 异步断言：reject TaigaPlatformError 且 category/subcause 匹配 */
export async function expectTaigaReject(
  fn: () => Promise<unknown>,
  category: ErrorCategory,
  subcause: string,
): Promise<void> {
  let caught: unknown = null
  try {
    await fn()
  } catch (err) {
    caught = err
  }
  expect(caught, '应当抛出 TaigaPlatformError').toBeInstanceOf(TaigaPlatformError)
  const err = caught as TaigaPlatformError
  expect(err.category).toBe(category)
  expect(err.subcause).toBe(subcause)
}
