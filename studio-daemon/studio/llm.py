"""llm — LLM 岛（唯一需要智能的地方）：DoD 生成 / QA 加测生成 / (v2) Epic 拆解
安全纪律（安全审查 P0-1/P1-3）：
- 文本岛禁 Bash（默认还禁网络抓取）；patrol 岛保留 WebFetch、禁 Bash/WebSearch
- 一切将被 bash 执行的岛输出必须过 _sanitize_cmd（&& 分段白名单）
- 失败返回 None，调用方确定性兜底——循环不因岛失败而停摆
- reviewed_ask：主 LLM 出稿 → Flash 语义审查兜底（dod_gen/加测/批示解析走它）"""
import json, shutil, subprocess, time
from pathlib import Path

from .config import CONFIG

CMD_WHITELIST_FIRST = ("test", "grep", "wc", "cat", "ls", "find", "diff", "head", "tail",
                       "dotnet", "python", "python3", "npm", "cargo", "make",
                       "git diff", "git log", "git status", "git rev-parse", "git show",
                       "git grep", "git ls-files")
CMD_BLACKLIST = ("rm ", "curl", "wget", "push", "sudo", "base64", "eval", "exec",
                 "-delete", "-exec", "-execdir", "-ok", "-fprintf", "-fprintf0",
                 "`", "$(", "|", ">", "<")
GIT_READONLY = {"diff", "log", "status", "rev-parse", "show", "grep", "ls-files", "blame", "shortlog"}
FIRST_WORDS = {"test", "grep", "wc", "cat", "ls", "find", "diff", "head", "tail",
               "dotnet", "python", "python3", "npm", "cargo", "make"}
INTERPRETER_WORDS = {"python", "python3", "npm", "cargo", "make", "dotnet"}
READONLY_WORDS = {"test", "grep", "wc", "cat", "ls", "find", "diff", "head", "tail"}


def _bad_path(tok: str) -> bool:
    """只读命令的参数只允许仓内相对路径：拒绝绝对路径、~、..（HEAD: 前缀剥离后同规则）。"""
    if tok.startswith("HEAD:"):
        tok = tok[5:]
    return tok.startswith("/") or tok.startswith("~") or ".." in tok


def _sanitize_cmd(cmd: str | None) -> str | None:
    """将被 bash -c 执行的命令消毒：按 && 分段，每段首词白名单 + 危险特征黑名单 + 长度。
    语义：允许 test -f a && grep -q x a（链式断言），拒绝替换/管道/重定向/后台/网络/删除。
    引号内是字面量：grep "a\\|b" 的 |、--logger "a;b" 的 ; 不是管道/分隔符，先保护再扫描。"""
    import re as _re
    if not cmd or not isinstance(cmd, str):
        return None
    c = cmd.strip()
    if len(c) > 300 or "\n" in c or c.count("&&") > 2:
        return None
    # 双引号段 → 占位符（黑名单与分段都在"引号外"的文本上判定）
    _protected = c
    _quotes = []
    for m in _re.finditer(r'"[^"]*"', _protected):
        if "$" in m.group() or "`" in m.group():      # 引号内变量/命令替换仍可逃逸，禁
            return None
        _quotes.append(m.group())
        _protected = _protected.replace(m.group(), f"__Q{len(_quotes)-1}__", 1)
    if "&" in _protected.replace("&&", ""):         # 单 & = 后台执行，禁
        return None
    if any(b in _protected for b in CMD_BLACKLIST):
        return None
    segs = _re.split(r"&&|;", _protected)
    segs_raw = _re.split(r"&&|;", c)
    for seg, seg_raw in zip(segs, segs_raw):
        toks = seg.strip().split()
        if not toks:
            return None
        w = toks[0]                            # 词元精确匹配（防 testX/grepped 前缀混淆）
        if w == "git":
            if len(toks) < 2 or toks[1] not in GIT_READONLY:
                return None
            if any(_bad_path(t) for t in toks[2:] if not t.startswith("-")):
                return None
        elif w in INTERPRETER_WORDS:
            # 解释器/构建段不享引号豁免：原始文本跑黑名单；禁内联执行参数
            if any(b in seg_raw for b in CMD_BLACKLIST):
                return None
            if "-c" in seg_raw.split() or "--eval" in seg_raw:
                return None
        elif w in READONLY_WORDS:
            if any(_bad_path(t) for t in toks[1:] if not t.startswith("-")):
                return None
        else:
            return None
    return c


FLASH = "glm-5.3-flash"       # 小模型：批示解析/DoD生成/加测/输出审查/派工预查——快、便宜
FLASHX = "glm-5.3-flashx"     # 快速模型：merge 等机械任务（端点实测清单 2026-09-20）
FULL = "glm-5.3"              # 主力模型：开发/策划/Epic拆解/巡逻/知识编辑——需要推理

_CLAUDE_CANDIDATES = ("~/.local/bin/claude", "/usr/local/bin/claude", "/opt/homebrew/bin/claude")
_CLAUDE_BIN = None            # 进程内缓存解析结果


def _claude_bin() -> str:
    """解析 claude 可执行路径。launchd 环境的 PATH 常缺 ~/.local/bin（claude 实际安装位），
    仅靠 PATH 查找会让守护进程里所有 LLM 岛 FileNotFoundError 且不可见——P0 事故根因。"""
    global _CLAUDE_BIN
    if _CLAUDE_BIN is None:
        _CLAUDE_BIN = shutil.which("claude") or next(
            (str(p) for p in (Path(c).expanduser() for c in _CLAUDE_CANDIDATES) if p.exists()),
            "claude")
    return _CLAUDE_BIN


_llm_fail_ts = 0.0            # 失败日志限速：同进程每 300s 至多记一条，防刷屏


def _llm_fail_log(note: str):
    global _llm_fail_ts
    if time.time() - _llm_fail_ts < 300:
        return
    _llm_fail_ts = time.time()
    try:
        with open(CONFIG.logs_dir / f"daemon-{time.strftime('%F')}.log", "a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%F %T')} [llm] ask FAILED bin={_claude_bin()} {note}\n")
    except Exception:
        pass


def ask(prompt: str, timeout_sec: int = 240, allow_web: bool = False,
        model: str = FULL) -> str | None:
    """单次 claude 调用。prompt 经 stdin 直传（P1-7）；
    文本岛默认禁 Bash/WebFetch/WebSearch；model=FLASH 用小模型。"""
    dis = ["Bash", "WebSearch", "WebFetch"] if not allow_web else ["Bash", "WebSearch"]
    try:
        p = subprocess.run(
            [_claude_bin(), "-p", "--dangerously-skip-permissions",
             "--model", model,
             "--disallowedTools", *dis, "--output-format", "json"],
            input=prompt, capture_output=True, text=True,
            timeout=timeout_sec)
        if p.returncode != 0:
            _llm_fail_log(f"model={model} rc={p.returncode} stderr={p.stderr[:200]!r}")
            return None
        data = json.loads(p.stdout)
        return data.get("result") or None
    except Exception as e:
        _llm_fail_log(f"model={model} {type(e).__name__}: {e}")
        return None


def review_output(prompt: str, output: str, timeout_sec: int = 60) -> dict | None:
    """Flash 审查岛：用 GLM-5.3-Flash 审查主 LLM 输出的语义正确性（STUDIO-12）。
    四查：与 prompt 要求一致 / 内容自洽（说做了X就真的做了X）/ 格式符合（JSON完整字段齐全）/ 明显幻觉。
    返回 {"verdict": "pass|fail", "issues": [str], "corrected": str|None}；
    审查自身失败（超时/非JSON/verdict不可识别）返回 None——调用方放行原稿，宁可放过不可误杀。"""
    try:
        res = ask(
            f"你是语义审查器，审查一份 LLM 输出是否合格。四查："
            f"1)输出是否与任务要求一致 2)内容是否自洽（说做了X就真的做了X）"
            f"3)格式是否符合要求（JSON完整、字段齐全）4)是否有明显幻觉（与上下文矛盾的事实）。\n"
            f"\n任务要求：\n{prompt}\n\n被审查输出：\n{output}\n\n"
            f'只输出 JSON（无其他文字）：{{"verdict":"pass或fail","issues":["问题",...],'
            f'"corrected":"修正后的完整输出，无把握就给空字符串"}}\n'
            "规则：合格必须 pass；只有发现确凿问题时才 fail，并尽量给 corrected"
            "（corrected 必须是完整可用的输出，不是片段）；issues 没有就空数组。",
            timeout_sec, model=FLASH)
    except Exception:
        return None
    if not res:
        return None
    try:
        d = json.loads(res[res.index("{"):res.rindex("}") + 1])
        verdict = str(d.get("verdict", "")).strip().lower()
        assert verdict in ("pass", "fail")            # 不可识别 = 审查不可信 = 审查失败
        issues = d.get("issues")
        corrected = d.get("corrected")
        corrected = corrected.strip() if isinstance(corrected, str) else None
        return {"verdict": verdict,
                "issues": [i for i in issues if isinstance(i, str)] if isinstance(issues, list) else [],
                "corrected": corrected or None}
    except Exception:
        return None


def reviewed_ask(prompt: str, timeout_sec: int = 240, allow_web: bool = False,
                 model: str = FULL) -> str | None:
    """ask() 的 Flash 语义审查兜底版（纯函数：不写板面不写文件，STUDIO-12）。
    主 LLM 出稿（timeout_sec，默认240s）→ review_output 审查（Flash，60s）→
    pass 放行原稿 / fail+corrected 用修正稿 / fail 无 corrected 重试一次（重试稿同样过审，
    仍无修正则放行重试稿）/ 审查自身失败放行原稿——宁可放过不可误杀。
    主 LLM 失败仍返回 None，调用方走确定性兜底（与 ask() 契约一致）。"""
    kw = {}                    # 只传非默认项，兼容 ask(prompt, timeout) 形状的调用替身
    if allow_web:
        kw["allow_web"] = True
    if model != FULL:
        kw["model"] = model
    out = ask(prompt, timeout_sec, **kw)
    if out is None:
        return None
    review = review_output(prompt, out)
    if review is None or review.get("verdict") == "pass":
        return out
    if review.get("corrected"):
        return review["corrected"]
    retry = ask(prompt, timeout_sec, **kw)   # fail 无修正 → 重试一次
    if retry is None:
        return out                           # 重试主调用失败 → 放行原稿
    review2 = review_output(prompt, retry)
    if review2 is None or review2.get("verdict") == "pass" or not review2.get("corrected"):
        return retry                         # 重试预算用尽 → 放行重试稿
    return review2["corrected"]


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
    res = reviewed_ask(
        f"为下述 YouTrack 单据生成**一条冻结验收命令**（bash 单行，可机器执行、退出码0=过，"
        f"路径用仓库相对路径，测试类优先项目既有测试命令，文档类用 test -f + grep，"
        f"确实无文件可查的恒真断言用 test -e /dev/null——严禁 test -f /dev/null，"
        f"/dev/null 是字符设备，test -f 对它恒假，会造成必然 GATE-FAIL 死循环）。"
        f"命令只允许 test/grep/wc/cat/ls/diff/git 子命令，禁止 ; && || $() 反引号 重定向。"
        f"只输出命令本身一行，不要解释。\nType={typ}\n标题: {ticket['summary']}\n"
        f"描述: {ticket['description']}")
    return _sanitize_cmd(_one_line(res))


def extra_test_gen(ticket: dict, frozen_gate: str) -> str | None:
    """QA 加测：生成一条 worker 没跑过、与冻结命令不同的验证命令——同样过消毒。"""
    res = reviewed_ask(
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
    res = reviewed_ask(
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
