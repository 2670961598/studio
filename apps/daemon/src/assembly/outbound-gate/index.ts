/**
 * outbound-gate —— daemon 统一出站闸（五出口＋三不入强制点；IMPL-07-11 唯一入口）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/plan/05 IMPL-07-11「出站扫描承担面·出站闸＋三不入」（LANE-E；依赖 IMPL-06-12
 *     出口义务先行；验收：NEG-SEC-07/N-g 失败事件可判定＋全出口覆盖、三不入强制点、
 *     仓面扫描脚本命中即拒）；
 *   - docs/v2/15 §4.4（SEC-SEC-04：出站扫描的承担者与观察面——五出口、失败词表、
 *     无通道出口登记缺口不静默）／§4.5（SEC-SEC-05：三不入与机器强制点）；
 *   - docs/v2/17 NEG-SEC-07/N-g；docs/audit-DSF/V13-01（承担者/失败出口缺口的治理面）；
 *   - docs/v2/16 §三 daemon 行（本目录落位 assembly/outbound-gate/）。
 *
 * 文件分域（单一职责，均 <600 行——20-§十五.三）：
 *   - exits.ts       五出口目录（唯一静态声明；gap 显式）
 *   - failures.ts    失败码/词表缺口登记/可判定失败记录（解析器）
 *   - scan.ts        扫描纯核（脱敏＋残留校验＋env 名打印检测；core 纯函数唯一实现）
 *   - three-not-in.ts 三不入强制点目录（库/提示词/日志）
 *   - gate.ts        统一执行体（计数/失败落账/覆盖快照/启动行）
 *   - wire.ts        装配 wrapper（平台写/通知/日志/库/证据导出/API 响应）＋失败台账落点
 *
 * 生产装配点：`assembly/serve/runtime.ts`（runServe 装配序）——prompt/日志/平台写/通知/库
 * 五个点真实过闸；证据导出与 API 响应登记为显式 gap（catalog status='gap'，接线面已备）。
 */
export * from './exits.ts'
export * from './failures.ts'
export * from './scan.ts'
export * from './three-not-in.ts'
export * from './gate.ts'
export * from './wire.ts'
