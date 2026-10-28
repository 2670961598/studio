/**
 * contract/test/v2/smoke.test.ts —— V2 新套件首件冒烟（MIG-02 / IMPL-02-01）
 *
 * 定位：**脚手架冒烟，不冒充 V2 业务覆盖**。本文件只证三件事——
 *   1. `test/v2` 能被 `vitest.v2.config.ts` 发现（plan/04 §1.9.4 第 2 条「用例数>0」成立）；
 *   2. 包名常量导出面在 V2 套件里可解析（workspace 解析与 import 图可用）；
 *   3. 冻结契约件 `packages/contract/cases.json` 可被 `test/v2` 读取，且 JSON import attribute
 *      写法正确（`with { type: "json" }`）——这条是**示范**，不是修旧测试：v2/13 §1.4 登记的
 *      旧测试 5 处缺 attribute 的件仍原样保留、只入旧测试台账（plan/04 §1.8）。
 *
 * 不计入 NEG 分配：contract 的 V1 腿（NEG- 119 分配里 MIG-03 起的 case 扩充）不归本波，
 * 本文件只是脚手架冒烟（plan/04 §三；plan/03 §三「契约 case 零新增」）。
 *
 * 依据：plan/04 §1.9.1/§1.9.2/§1.9.4、plan/03 §三（MIG-02 产物）、plan/05 IMPL-02-01、
 *       docs/v2/13 §1.4（JSON import attribute 口径）、docs/v2/17 §一（V1 层口径）。
 */
import { describe, expect, it } from 'vitest'
import { PACKAGE_NAME } from '../../src/index.ts'
import cases from '../../cases.json' with { type: 'json' }

describe('V2 新套件脚手架冒烟（非业务覆盖）', () => {
  it('contract 包名常量可解析：@studio-next/contract', () => {
    expect(PACKAGE_NAME).toBe('@studio-next/contract')
  })

  it('冻结契约件可读：cases.json version=1 且 cases 非空', () => {
    expect(cases.version).toBe(1)
    expect(cases.cases.length).toBeGreaterThan(0)
  })
})
