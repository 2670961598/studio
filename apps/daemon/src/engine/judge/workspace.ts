/**
 * judge/workspace —— 一次性调用工作区（studio-dev-160 §6.1/§8 红队 2；单 164）
 *
 * 语义（提案 §6.1「无工具只读沙箱 + 一次性空工作区」）：
 *   - 每次 judge 调用一个**全新目录树**（父目录 mkdtemp 独得），调用毕整树删除——
 *     不复用、不留产物、不跨调用共享任何状态（判断调用零生命周期）。
 *   - 树内四落位：
 *       workspace/  空目录=judge 的 cwd（TaskBrief.workspace）——**只读**（seatbelt
 *                   写域不含它，workspace.ts 不负责圈定——dsh 派发面 writeRootsOverride
 *                   只放 dshHome，见 invoke.ts）；
 *       dsh-home/   DSH_HOME 重定向落点=**唯一写域**（dsh boot 必写 profile/状态）；
 *       profile/    seatbelt profile 落盘（workspace 外——调用毕随树删，不污染断言面）；
 *       brief/      任务书 + judge 指令文件落位（dsh 读任务串=brief.md 内容）。
 *   - 「调用毕 workspace 空」是测试断言面（S4）：树外路径一概不写，断言才立得住。
 *
 * 依据：docs/17-§6 dsh 行（launch 读 briefPath 任务串）；docs/25-§二 TaskBrief 口径；
 * OS 临时区纪律（仓库不得出现本机路径——tmpdir() 运行时取值，不进源码不进台账）。
 */
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 一次性目录树四落位（invoke 全流程只经此结构触盘） */
export interface JudgeCallDirs {
  /** 树根（清理单位=rm -rf 此目录） */
  readonly root: string
  /** judge 的空工作区（只读面——seatbelt 写域不含它） */
  readonly workspace: string
  /** DSH_HOME 重定向（唯一写域：dsh boot 必写） */
  readonly dshHome: string
  /** seatbelt profile 落盘目录（workspace 外） */
  readonly profileDir: string
  /** 任务书/指令文件目录 */
  readonly briefDir: string
  /** 整树删除（幂等；调用方 finally 收口） */
  readonly cleanup: () => void
}

/**
 * 开一次性调用目录树。prefix 固定 `studio-next-judge-`（tmp 区可辨识：ps/lsof 排查面；
 * 不含单号——tmp 路径不进台账/日志，树名无证据价值）。
 * opts.parent：测试注入固定父目录（断言不碰系统 tmp）；缺省 os.tmpdir()。
 */
export function createJudgeCallDirs(opts: { parent?: string } = {}): JudgeCallDirs {
  const root = mkdtempSync(join(opts.parent ?? tmpdir(), 'studio-next-judge-'))
  const workspace = join(root, 'workspace')
  const dshHome = join(root, 'dsh-home')
  const profileDir = join(root, 'profile')
  const briefDir = join(root, 'brief')
  for (const dir of [workspace, dshHome, profileDir, briefDir]) {
    mkdirSync(dir, { recursive: true })
  }
  let gone = false
  return {
    root,
    workspace,
    dshHome,
    profileDir,
    briefDir,
    cleanup: () => {
      if (!gone) {
        gone = true
        rmSync(root, { recursive: true, force: true })
      }
    },
  }
}
