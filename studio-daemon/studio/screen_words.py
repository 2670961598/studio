"""screen_words — 出生-交付两道闸共享的危险词表（单一事实源，STUDIO-98）

POLY-53 实录（2026-10-05 05:20）：巡逻孵化单的验收命令
`dotnet test ... --filter "FullyQualifiedName~X"`（FQN 过滤器语法必含中缀 ~）
过了出生闸（llm._sanitize_cmd 放行），却在派发闸（gates.run_gate）撞上
词表裸 `"~"` 通配（本意拦家目录展开）→ GATE-DANGEROUS 拒跑，单据出生即
不可交付，每拍重试烧 attempt 至断路。

铁律（出生-交付同源）：派发闸词表 GATE_DANGER 必须是消毒器词表
CMD_BLACKLIST 的子集——凡出生侧放行的命令，交付侧必须可跑；消毒器按
"生成侧提示词告知"的口径可更严（多拦无害），反向（闸多拦、消毒器少拦）
即出生即不可交付。两道闸一律引用本模块常量，禁止再各自内联散写。"""

# 派发闸（gates.run_gate 危险快筛）：只挡"破坏/注入原语"+ 命令替换 + 系统路径 +
# 家目录展开形态 "~/"。中缀裸 ~ 无害——dotnet FQN 过滤器 FullyQualifiedName~X
# 必含（POLY-53：曾按裸 "~" 通配误杀拒跑，STUDIO-98 收窄）。
GATE_DANGER = ("rm ", "curl", "wget", "sudo", "push", "base64", "eval", "exec",
               "$(", "`", "/etc/", "/Users/", "~/")

# 消毒器（llm._sanitize_cmd）在派发闸基线上的更严口径（生成侧提示词本就禁
# 这些，多拦无害）：find 写文件/执行原语参数 + shell 复合语法（管道/重定向）。
SANITIZER_EXTRA = ("-delete", "-exec", "-execdir", "-ok", "-fprintf", "-fprintf0",
                   "|", ">", "<")

# 消毒器词表 = 派发闸基线 + 更严口径（GATE_DANGER ⊆ CMD_BLACKLIST 恒成立）
CMD_BLACKLIST = GATE_DANGER + SANITIZER_EXTRA
