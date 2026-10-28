/**
 * assets/index —— 公司资产部出口（DOM-07；84-D1a；IMPL-05-01＋05-02）
 *
 * 分件：
 *   - types.ts：资产模型与装载报告形状（assetId/type/contentDigest/provenance/binding/
 *     targetExecutor/requiredness/availability；专属标记与目标执行器不丢）；
 *   - registry.ts：资产清单唯一索引（无清单=零资产，不默认全收）＋目录契约定位＋byte 摘要；
 *   - hygiene.ts：路径逃逸/秘密与本机路径/可执行内容/挂载戳记（只读扫描，绝不执行）；
 *   - loader.ts：装载报告（loaded/missing/incompatible/blocked 逐项明示；必备不可用二选一）；
 *   - defpkg.ts：PKG-DEF 清单闭包＋目录卫生＋CL 结构判据＋身份主张从属；
 *   - import.ts：先校验后落位、失败零落位（暂存 rename 原子提交）。
 *
 * 纪律：资产部与定义部分成分、part、授权；传播≠授权；Dsh 插件是专属资产（84-D1），
 * 换执行器的能力损失是明示代价，不是缺陷（v2/06 §〇 根立场）。
 */
export * from './types.ts'
export * from './registry.ts'
export * from './hygiene.ts'
export * from './loader.ts'
export * from './defpkg.ts'
export * from './import.ts'
