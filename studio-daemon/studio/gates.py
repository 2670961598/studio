"""gates — 冻结验收执行器（run-gate 原生版，证据 JSON 与 bash 版字段兼容）
"完成"只认这里的落盘证据，不认任何 agent 自述。"""
import hashlib, json, subprocess, time
from pathlib import Path
from .config import CONFIG
from .screen_words import GATE_DANGER


class GateResult(dict):
    @property
    def ok(self) -> bool:
        return self["exit"] == 0


def run_gate(issue: str, attempt_tag: str, lane: str, acct: str = "agent-8") -> GateResult:
    from .yt import YT
    t = YT(acct)
    if not lane:
        lane = t.f(issue, "泳道") or "core"
    cmd = t.f(issue, "验收命令")
    if not cmd:
        raise RuntimeError(f"GATE-NO-CMD {issue} 缺冻结验收命令")
    # 危险快筛（第四批→GAMES-84 误伤修正）：只挡"破坏/注入原语"——
    # rm/curl/wget/sudo/push/base64/eval/exec、命令替换 $( 与反引号、系统路径。
    # shell 正常语法（| > < ; for/循环）不拦：手工冻结的合法命令常用
    # （GAMES-84 实录：cd /abs && for g in ... 曾被误杀卡单）。
    # STUDIO-98（POLY-53 实录 2026-10-05）：词表同源化至 screen_words.GATE_DANGER
    # ——裸 "~" 收窄为 "~/"（只拦家目录形态），dotnet FQN 过滤器
    # --filter "FullyQualifiedName~X" 的中缀波浪号不再误杀；且派发闸词表
    # 必须是消毒器（llm.CMD_BLACKLIST）词表的子集——凡出生放行的必须可交付。
    if any(d in cmd for d in GATE_DANGER):
        raise RuntimeError(f"GATE-DANGEROUS {issue} 验收命令含危险特征，拒跑：{cmd[:80]}")
    repo = CONFIG.lane(lane)["path"]
    if lane == "explore":
        # 探索通道：每单独立工作区即闸门 cwd（产物相对路径与 worker 一致）
        repo = str(Path(repo) / issue)
        Path(repo).mkdir(parents=True, exist_ok=True)
    pid = issue.split("-")[0]
    evdir = CONFIG.evidence_dir / pid
    evdir.mkdir(parents=True, exist_ok=True)
    ev, log = evdir / f"{issue}-{attempt_tag}.json", evdir / f"{issue}-{attempt_tag}.log"
    commit = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=repo,
                            capture_output=True, text=True).stdout.strip() or "nogit"
    branch = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=repo,
                            capture_output=True, text=True).stdout.strip() or "detached"
    try:
        proc = subprocess.run(["bash", "-c", cmd], cwd=repo, capture_output=True,
                              text=True, timeout=600)
    except subprocess.TimeoutExpired as e:
        # TimeoutExpired.stdout/stderr 恒为 bytes（与 text=True 无关），必须先 decode
        out = e.stdout.decode("utf-8", "replace") if isinstance(e.stdout, bytes) else (e.stdout or "")
        err = e.stderr.decode("utf-8", "replace") if isinstance(e.stderr, bytes) else (e.stderr or "")
        proc = subprocess.CompletedProcess([], 124,
                                           out + f"\n[GATE-TIMEOUT 600s]",
                                           err)
    log.write_text(proc.stdout + proc.stderr)
    res = GateResult({
        "issue": issue, "project": pid, "attempt": attempt_tag, "lane": lane,
        "branch": branch, "commit": commit, "cmd": cmd, "exit": proc.returncode,
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "log": str(log),
        "log_sha256_16": hashlib.sha256(log.read_bytes()).hexdigest()[:16],
    })
    ev.write_text(json.dumps(res, ensure_ascii=False, indent=2))
    return res


def report_gate(res: GateResult) -> str:
    return ("GATE-PASS" if res.ok else "GATE-FAIL") + f" {res['issue']} exit={res['exit']} evidence={res['log'][:-4]}.json"
