/**
 * judge/brief —— 判断任务书合成（studio-dev-160 §6.1；单 164）
 *
 * 语义（提案 §6.1「框架组装结构化上下文 → 低档小模型**只回一个 JSON 对象**」）：
 *   - 任务串（brief.md）= 判断调用的**全部输入**：角色一句 + 词表声明（op/参数键/域）
 *     + 结构化上下文 JSON + 输出格式铁律（裸 JSON 对象、无围栏无解说、键集恰等词表）。
 *     输出铁律写在任务串里而不是指望系统提示——bridge 插件未挂载时 env 无消费者
 *     （docs/31-A1），任务串是唯一可靠通道（S5 spike 结论：dsh headless 任务=位置参数）。
 *   - TaskBrief 合成（docs/25-§二）：
 *       ticket=`mj-<callId>`（哨兵单号——判断调用不占派工单号空间，台账 issue 列挂
 *       site_id 哨兵见 events.ts；零生命周期=不进 work_records/收割面）；
 *       attempt=1（一次性，无重试——LLM_FAIL 处置分叉=立即降级，17-§9）；
 *       workspace=一次性空目录（只读）；AGENTS_MD=user_level 通道（target=树内
 *       judge-instructions.md，指令文件同任务串口径——双通道冗余，哪个在哪个生效）；
 *       **credentials 永不设置**（零凭据：判断输入=框架内上下文，无外部资源可取——
 *       S8 红队：不引入「判断调用也要 wkey」的新凭据面）；budgetCap 不设（三帽在
 *       accounts.ts 预算面，不走 TaskBrief.budgetCap——那是任务派工的 per-attempt 帽）。
 *   - 词表域的 enum 候选集在**词表声明**里给全（上下文 JSON 只给事实，不给新自由度：
 *     模型从词表候选集里选，选外=三道闸拒——parseJudgeVerdict 收口）。
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TaskBrief } from '@studio-next/contract'
import type { JudgeVocab } from '@studio-next/core'

/** 判断调用的固定角色句（§6.1：小模型=判定器不是对话者——角色一句即止） */
const JUDGE_ROLE_LINE =
  '你是判定器：只依据给定上下文，从冻结词表中选一个操作及其参数作答。不要解释、不要推演过程、不要使用任何工具。'

/** 输出铁律（三道闸的提示面：闸在框架侧收口，此处只是把规矩说清——降模型噪音） */
const JUDGE_OUTPUT_RULES = [
  '输出必须且只能是一个 JSON 对象，形如 {"op":<string>,"params":{<键>:<值>}}。',
  'op 必须取自词表；params 的键集必须与所选 op 的参数键集完全一致（不许多键、不许少键）。',
  'enum 域的值必须取自该域给定的候选集；string 域必须是非空字符串；string-list 域必须是非空字符串数组。',
  '禁止代码围栏、禁止前后解说文字、禁止顶层附加键（如 confidence）。',
].join('\n')

/** 词表声明渲染（人读面——模型读；域形状与 parseJudgeVerdict 判定一一对应） */
function renderVocab(vocab: JudgeVocab): string {
  const ops = vocab.ops
    .map((spec) => {
      const params = Object.entries(spec.params)
        .map(([key, domain]) =>
          domain.kind === 'enum'
            ? `${key}: 枚举，候选=[${domain.values.join(', ')}]`
            : domain.kind === 'string'
              ? `${key}: 非空字符串`
              : `${key}: 非空字符串数组`,
        )
        .join('; ')
      return `- ${spec.op}${params === '' ? '（无参数）' : `（参数: ${params}）`}`
    })
    .join('\n')
  return `词表（冻结——只可从中选择，无扩展权）：\n${ops}`
}

/** 上下文渲染：调用方给结构化事实（对象/数组），此函数序列化为 JSON 块 */
function renderContext(factsJson: string): string {
  return `上下文（判断依据——只此为准）：\n${factsJson}`
}

/** 完整任务串（=brief.md 内容=dsh headless 位置参数任务文本） */
export function renderJudgePrompt(input: { vocab: JudgeVocab; factsJson: string }): string {
  return [
    JUDGE_ROLE_LINE,
    '',
    JUDGE_OUTPUT_RULES,
    '',
    renderVocab(input.vocab),
    '',
    renderContext(input.factsJson),
  ].join('\n')
}

/** AGENTS.md user_level 通道的指令文件内容（与任务串同口径——bridge 挂载时的系统提示面） */
export function renderJudgeInstructions(): string {
  return [
    '# micro-judge 判定器指令',
    '',
    '你被用作 micro-judge 判定器：每次任务只输出一个 JSON 对象（操作+参数），',
    '从任务文本给出的冻结词表中选取。禁止工具调用、禁止文件写入、禁止解释文字。',
    '输出由框架三道闸校验，不合格即弃用并回退机械规则——精确比聪明重要。',
    '',
  ].join('\n')
}

/**
 * 落盘任务书+指令文件并合成 TaskBrief（零凭据：credentials 键永不出现——测试断言面）。
 * callId=本次调用 ULID（票号哨兵 mj-<callId>；幂等落位：同名覆盖=同调用重放，不新增件）。
 * prompt=renderJudgePrompt 产物（invoke 先渲染拿字符量做估算，此处落盘同一文本——
 * 估算与实发同源，不二渲染）。
 */
export function buildJudgeTaskBrief(dirs: {
  workspace: string
  briefDir: string
}, call: { callId: string; prompt: string }): TaskBrief {
  const briefPath = join(dirs.briefDir, 'brief.md')
  const instructionsPath = join(dirs.briefDir, 'judge-instructions.md')
  writeFileSync(briefPath, call.prompt, 'utf8')
  writeFileSync(instructionsPath, renderJudgeInstructions(), 'utf8')
  return {
    ticket: `mj-${call.callId}`,
    attempt: 1,
    briefPath,
    workspace: dirs.workspace,
    AGENTS_MD: { channel: 'user_level', target: instructionsPath },
  }
}
