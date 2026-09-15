"""llm — LLM 岛（唯一需要智能的地方）：DoD 生成 / QA 加测生成 / (v2) Epic 拆解
每个岛 = 一次 claude -p 调用（--output-format json，机器解析）；失败返回 None，
调用方必须有确定性兜底或安全降级——循环不因岛失败而停摆。"""
import json, subprocess, tempfile, os


def ask(prompt: str, timeout_sec: int = 240) -> str | None:
    """单次 claude 调用，返回 result 文本；失败返回 None。"""
    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False, encoding="utf-8") as f:
        f.write(prompt)
        pf = f.name
    try:
        p = subprocess.run(
            ["claude", "-p", "--dangerously-skip-permissions", "--output-format", "json", pf],
            stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=timeout_sec)
        if p.returncode != 0:
            return None
        data = json.loads(p.stdout)
        return data.get("result") or None
    except Exception:
        return None
    finally:
        os.unlink(pf)


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
    """为无验收命令的新单生成冻结验收命令（一行 bash，退出码即判据）。"""
    typ = ticket["fields"].get("Type") or "业务"
    res = ask(
        f"为下述 YouTrack 单据生成**一条冻结验收命令**（bash 单行，可机器执行、退出码0=过，"
        f"路径用仓库相对路径，测试类优先项目既有测试命令，文档类用 test -f + grep）。"
        f"只输出命令本身一行，不要解释。\nType={typ}\n标题: {ticket['summary']}\n"
        f"描述: {ticket['description']}")
    return _one_line(res)


def extra_test_gen(ticket: dict, frozen_gate: str) -> str | None:
    """QA 加测：生成一条 worker 没跑过、与冻结命令不同的验证命令。"""
    res = ask(
        f"QA 复测加测命令生成。单据: {ticket['summary']}\n冻结验收命令(工人已跑): {frozen_gate}\n"
        f"生成**一条不同角度**的 bash 验证命令（检查冻结命令没覆盖的点，如另一关键词/文件数/结构断言），"
        f"只输出命令本身一行。")
    return _one_line(res)


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
