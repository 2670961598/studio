/**
 * artifacts 分区出口（MIG-03 / IMPL-03-05）——冻结 JSON Schema 工件的离线生成与漂移检查
 *
 * 本分区**不接包根出口**（`src/index.ts` 不动：工件的回退点＝删本目录、恢复原导出面，零运行期依赖）。
 * 消费方：`packages/contract/test/v2/artifacts/`（V2 伴测）与 `cli.ts`（`bun run contract:check`）。
 *
 * 边界：`src/records/`（74 类 zod 形状）是唯一来源；本分区只做「形状 → 冻结工件」的离线投影与比对，
 * 不新增记录类、不定义字段、不写 ports，也不参与任何运行时路径（DEC-13-11）。
 */
export * from './generate.ts'
export * from './check.ts'
