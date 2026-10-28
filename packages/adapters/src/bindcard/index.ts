/**
 * bindcard/index —— 执行宿主绑定档案出口（BIND-；IMPL-07-05）
 *
 * 分件：
 *   - types.ts：卡形状面（必答十二行行集/现状四值/探针三态/损失三值）＋Result 与冻结工具；
 *   - dsh-card.ts：BIND-DSH-01 卡本体（§1.1/§1.2/§1.4/§1.5）＋专属面与通用必达面；
 *   - cli-cards.ts：BIND-CLI-CLAUDE/CODEX/KIMI-01 三卡＋PB-6 拟稿点登记＋fail-closed 能力对齐；
 *   - card.ts：装载面（卡可查＋版本锁比对＋卡内不变量校验；外域卡指名归属不复制）；
 *   - activation.ts：激活代次＋围栏（两轴独立；幂等键＝域×端点×代次；纯函数账本）；
 *   - capability.ts：能力包只携引用（拒内嵌内容/自封权威）＋专属/通用可用性判定；
 *   - selection.ts：执行器选择链登记＋派发解析（NEG-RUN-05 代偿校验）。
 *
 * 纪律：绑定不是授权（v2/12 §〇.2）；「已有」面只表仓内实现/接线事实，不宣称机制保证；
 * 探针未执行不得写成「预期通过」；本包不改 daemon/其它包，落账与强制点归各自施工单。
 */
export * from './types.ts'
export * from './dsh-card.ts'
export * from './cli-cards.ts'
export * from './card.ts'
export * from './activation.ts'
export * from './capability.ts'
export * from './selection.ts'
