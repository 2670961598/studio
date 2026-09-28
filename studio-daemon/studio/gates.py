"""gates — 冻结验收执行器（run-gate 原生版，证据 JSON 与 bash 版字段兼容）
"完成"只认这里的落盘证据，不认任何 agent 自述。"""
import hashlib, json, subprocess, time
from pathlib import Path
from .config import CONFIG


class GateResult(dict):
    @property
    def ok(self) -> bool:
        return self["exit"] == 0


def run_gate(issue: str, attempt_tag: str, lane: str, acct: str = "agent-pm") -> GateResult:
    from .yt import YT
    t = YT(acct)
    if not lane:
        lane = t.f(issue, "泳道") or "core"
    cmd = t.f(issue, "验收命令")
    if not cmd:
        raise RuntimeError(f"GATE-NO-CMD {issue} 缺冻结验收命令")
    # 危险快筛（第四批：dod_gen/patrol 已过白名单消毒，但验收命令可被手工设置——
    # 存量 32 张含 cd /abs、env 前缀等。此处兜底拒最坏：删除/网络/提权/写系统路径。
    # 拒跑 raise 冒泡为 TICK ERROR（不执行、不计 attempt、留痕人工处置）。
    from .llm import CMD_BLACKLIST
    danger = ("rm ", "curl", "wget", "sudo", "push", "base64", "eval", "exec",
              "`", "$(", "|", ">", "<", "/etc/", "/Users/", "~")
    if any(d in cmd for d in danger) or any(b in cmd for b in CMD_BLACKLIST):
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
