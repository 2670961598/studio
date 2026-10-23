/**
 * directive/ —— 批示载体归一层特性域（studio-dev-171，130-§6.1 / docs/18-§2.5；
 * 20-§十五 contrib 模式：新特性开 <域>/<特性>/ 子文件夹）。
 *
 *   parse.ts       词表 v1 行式解析（纯函数）
 *   qualify.ts     角色校验＋派单律（fail-closed 纯函数核）
 *   wire.ts        引擎相位 1 尾接线体（IO）＋5a 回弹抑制判定
 *   serve-config.ts  serve 装配缝（daemon.yaml 键 → DirectiveGateDeps）
 */
export { DIRECTIVE_VERBS, parseDirectiveComment, type DirectiveParse, type DirectiveVerb } from './parse.ts'
export {
  buildDirectiveAuthorizer,
  type DirectiveAuthorizer,
  type DirectiveGateDeps,
  type DirectiveIssueFacts,
  type DirectivePerson,
  type DirectiveQualify,
} from './qualify.ts'
export {
  engineDirectiveDeps,
  reboundSuppressed,
  runDirectiveLayer,
  type DirectiveLayerDeps,
  type DirectiveLayerResult,
  type EngineDirectiveClosures,
} from './wire.ts'
export { buildServeDirectiveDeps, parseWhitelistSpec, type ServeDirectiveOptions } from './serve-config.ts'
