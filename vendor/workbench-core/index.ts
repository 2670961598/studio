/**
 * vendor/workbench-core —— Workbench issues/collab 源码快照薄包装（task-63 Phase0）
 *
 * 只 re-export 本目录内 vendored 源码；不 import 宿主机路径、StudioNext/DSH/daemon、网络。
 * 契约：thin wrapper 只暴露 namespaced `issues` / `collab`；升级=整目录快照替换。
 */
export * as issues from './issues/src/index.ts'
export * as collab from './collab/src/index.ts'
