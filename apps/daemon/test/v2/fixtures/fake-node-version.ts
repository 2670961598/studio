/**
 * fake-node-version —— 入口版本 fail-fast 测试夹具（NEG-ENG-04；V4 真进程）
 *
 * 用法（真入口，不改生产代码分支）：
 *   STUDIO_NEXT_FAKE_NODE_VERSION=20.19.0 \
 *   node --import <本文件> apps/daemon/src/index.ts --config <任意>
 *
 * 原理：`process.versions.node` 在 Node 24.21 实测可配置（descriptor configurable=true），
 * 故前置夹具可把入口读到的版本串改写为旧版/坏串，让**真入口**走到版本闸的不同分支。
 * 只注入入口前置态：不写盘、不改仓内文件、不引端口/运行时常驻面——测试结束即随进程消失。
 */
const fake = process.env['STUDIO_NEXT_FAKE_NODE_VERSION']
if (fake !== undefined) {
  Object.defineProperty(process.versions, 'node', { value: fake, configurable: true })
}
