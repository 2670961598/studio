"""llm — LLM 岛（唯一需要智能的地方）：DoD 生成 / QA 加测生成 / (v2) Epic 拆解
安全纪律（安全审查 P0-1/P1-3）：
- 文本岛禁 Bash（默认还禁网络抓取）；patrol 岛保留 WebFetch、禁 Bash/WebSearch
- 一切将被 bash 执行的岛输出必须过 _sanitize_cmd（&& 分段白名单）
- 失败返回 None，调用方确定性兜底——循环不因岛失败而停摆"""
import json, subprocess

CMD_WHITELIST_FIRST = ("test", "grep", "wc", "cat", "ls", "find", "diff", "head", "tail",
                       "dotnet", "python", "python3", "npm", "cargo", "make",
                       "git diff", "git log", "git status", "git rev-parse", "git show",
                       "git grep", "git ls-files")
CMD_BLACKLIST = ("rm ", "curl", "wget", "push", "sudo", "base64", "eval", "exec",
                 "-delete", "-exec", "-execdir", "-ok", "-fprintf", "-fprintf0",
                 ";", "`", "$(", "|", ">", "<")
GIT_READONLY = {"diff", "log", "status", "rev-parse", "show", "grep", "ls-files", "blame", "shortlog"}
FIRST_WORDS = {"test", "grep", "wc", "cat", "ls", "find", "diff", "head", "tail",
               "dotnet", "python", "python3", "npm", "cargo", "make"}


def _sanitize_cmd(cmd: str | None) -> str | None:
    """将被 bash -c 执行的命令消毒：按 && 分段，每段首词白名单 + 危险特征黑名单 + 长度。
    语义：允许 test -f a && grep -q x a（链式断言），拒绝替换/管道/重定向/后台/网络/删除。"""
    if not cmd or not isinstance(cmd, str):
        return None
    c = cmd.strip()
    if len(c) > 300 or "\n" in c or c.count("&&") > 2:
        return None
    if "&" in c.replace("&&", ""):            # 单 & = 后台执行，禁
        return None
    if any(b in c for b in CMD_BLACKLIST):
        return None
    for seg in c.split("&&"):
        toks = seg.strip().split()
        if not toks:
            return None
        w = toks[0]                            # 词元精确匹配（防 testX/grepped 前缀混淆）
        if w == "git":
            if len(toks) < 2 or toks[1] not in GIT_READONLY:
                return None
        elif w not in FIRST_WORDS:
            return None
    return c


FLASH = "GLM-5.3-Flash"       # 小模型：批示解析/DoD生成/加测——快、便宜、多模态
FULL = "GLM-5.3"              # 大模型：Epic拆解/巡逻/知识编辑——需要推理


def ask(prompt: str, timeout_sec: int = 240, allow_web: bool = False,
        model: str = FULL) -> str | None:
    """单次 claude 调用。prompt 经 stdin 直传（P1-7）；
    文本岛默认禁 Bash/WebFetch/WebSearch；model=FLASH 用小模型。"""
    dis = ["Bash", "WebSearch", "WebFetch"] if not allow_web else ["Bash", "WebSearch"]
    try:
        p = subprocess.run(
            ["claude", "-p", "--dangerously-skip-permissions",
             "--model", model,
             "--disallowedTools", *dis, "--output-format", "json"],
            input=prompt, capture_output=True, text=True,
            timeout=timeout_sec)
        if p.returncode != 0:
            return None
        data = json.loads(p.stdout)
        return data.get("result") or None
    except Exception:
        return None


def _one_line(res: str | None) -> str | None:
    """从回复中抽出真正的命令行：跳过围栏/标题/解释行，必须有命令特征。"""
    if not res:
        return None
    marks = ("test ", "grep", "&&", "||", "diff", "dotnet", "python", "npm",
             "cargo", "cat ", "wc ", "ls ", "git ")
    best = None
    for ln in res.strip().splitlines():
        s = ln.strip().strip("`").strip()
        if not s or s.startswith(("#", "-", "*", "答案", "命令")) or s in ("bash", "sh", "shell"):
            continue
        if len(s) > 500 or s.count('"') % 2 == 1:
            continue
        if any(m in s for m in marks):
            best = s  # 取最后一条带命令特征的行（通常是最终版）
    return best


def dod_gen(ticket: dict) -> str | None:
    """为无验收命令的新单生成冻结验收命令（一行 bash，退出码即判据）——过消毒白名单。"""
    typ = ticket["fields"].get("Type") or "需求"
    res = ask(
        f"为下述 YouTrack 单据生成**一条冻结验收命令**（bash 单行，可机器执行、退出码0=过，"
        f"路径用仓库相对路径，测试类优先项目既有测试命令，文档类用 test -f + grep）。"
        f"命令只允许 test/grep/wc/cat/ls/diff/git 子命令，禁止 ; && || $() 反引号 重定向。"
        f"只输出命令本身一行，不要解释。\nType={typ}\n标题: {ticket['summary']}\n"
        f"描述: {ticket['description']}")
    return _sanitize_cmd(_one_line(res))


def extra_test_gen(ticket: dict, frozen_gate: str) -> str | None:
    """QA 加测：生成一条 worker 没跑过、与冻结命令不同的验证命令——同样过消毒。"""
    res = ask(
        f"QA 复测加测命令生成。单据: {ticket['summary']}\n冻结验收命令(工人已跑): {frozen_gate}\n"
        f"生成**一条不同角度**的 bash 验证命令（检查冻结命令没覆盖的点），"
        f"命令只允许 test/grep/wc/cat/ls/diff，禁止 ; && || $() 反引号 重定向。"
        f"只输出命令本身一行。", 240, model=FLASH)
    return _sanitize_cmd(_one_line(res))


def epic_split(ticket: dict) -> list[dict] | None:
    """v2 预留：Epic→≤5 子单 DAG。返回 [{summary, description, type}] 或 None。"""
    res = ask(
        f"把下述 Epic 拆成≤5张子单（含依赖顺序），输出 JSON 数组，元素字段: "
        f'summary/description/type(核心|业务|策划|美术)。只输出 JSON。\n标题: {ticket["summary"]}\n'
        f'描述: {ticket["description"]}')
    if not res:
        return None
    try:
        data = json.loads(res[res.index("["):res.rindex("]") + 1])
        assert isinstance(data, list) and 0 < len(data) <= 5
        for it in data:
            assert it.get("summary") and it.get("type")
        return data
    except Exception:
        return None


def parse_directive(comment_text: str, context: str = "") -> dict | None:
    """批示理解岛：让 LLM 读制作人评论，返回结构化指令 JSON。
    返回 {"directive": "approve-plan|approve-merge|approve-design|approve|reject|kill|promote|track|none",
          "level": "L0|L1|L2|L3|A|B|C", "confidence": 0.95}
    失败返回 None（调用方回退到字符串匹配兜底）。"""
    res = ask(
        f"你是工作室批示解析器。制作人(opengames)在单据上写了这条评论：\n"
        f"「{comment_text}」\n"
        f"单据上下文：{context}\n"
        f"判断这是什么指令，只输出 JSON（无其他文字）：\n"
        '{{"directive":"approve-plan|approve-merge|approve-design|approve|reject|kill|promote|track|none",'
        '"level":"L0|L1|L2|L3|none","confidence":0.95}}\n'
        "规则：批准/同意/通过→approve 或 approve-plan/approve-merge/approve-design（按上下文判断是哪一批）；"
        "否决/取消/杀→reject/kill；转正→promote；改级别→track+level；无法判断→none。", 120, model=FLASH)
    if not res:
        return None
    try:
        d = json.loads(res[res.index("{"):res.rindex("}") + 1])
        assert d.get("directive")
        return d
    except Exception:
        return None
