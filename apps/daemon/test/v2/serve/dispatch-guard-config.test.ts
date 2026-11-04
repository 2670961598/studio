/**
 * 775/C2/C3 —— daemon.yaml 派工排除/监控键解析（fail-closed）
 *
 * 键：autoAssignExcludePeople / autoAssignExcludeRoles / executionGuardRoles /
 * executionGuardKeywords（分号或逗号清单，去重；空清单拒）。
 */
import { describe, expect, it } from 'vitest'
import { parseDaemonConfig } from '../../../src/assembly/serve/config.ts'

const BASE_YAML = ['db: ./x.sqlite', 'company: demo', 'platform: localfile'].join('\n')

describe('派工排除/执行监控配置面（775/C2/C3）', () => {
  it('缺省 undefined（行为零变）', () => {
    const cfg = parseDaemonConfig(BASE_YAML)
    expect(cfg.autoAssignExcludePeople).toBeUndefined()
    expect(cfg.autoAssignExcludeRoles).toBeUndefined()
    expect(cfg.executionGuardRoles).toBeUndefined()
    expect(cfg.executionGuardKeywords).toBeUndefined()
  })

  it('分号/逗号清单解析 + 去重（REL-1/发布岗）', () => {
    const cfg = parseDaemonConfig(
      `${BASE_YAML}\nautoAssignExcludePeople: REL-1;REL-1\n;autoAssignExcludeRoles: 发布岗,定价发布岗`.replace(`${BASE_YAML}\nautoAssignExcludePeople: REL-1;REL-1\n;autoAssignExcludeRoles: 发布岗,定价发布岗`, `${BASE_YAML}\nautoAssignExcludePeople: REL-1;REL-1\nautoAssignExcludeRoles: 发布岗,定价发布岗\nexecutionGuardRoles: 发布岗\nexecutionGuardKeywords: deploy;tag,push`),
    )
    expect(cfg.autoAssignExcludePeople).toEqual(['REL-1'])
    expect(cfg.autoAssignExcludeRoles).toEqual(['发布岗', '定价发布岗'])
    expect(cfg.executionGuardRoles).toEqual(['发布岗'])
    expect(cfg.executionGuardKeywords).toEqual(['deploy', 'tag', 'push'])
  })

  it('空清单/仅分隔符 → 拒（fail-closed，不静默空集）', () => {
    expect(() => parseDaemonConfig(`${BASE_YAML}\nautoAssignExcludePeople: ;`)).toThrow(/autoAssignExcludePeople/)
    expect(() => parseDaemonConfig(`${BASE_YAML}\nexecutionGuardRoles: ,`)).toThrow(/executionGuardRoles/)
  })
})
