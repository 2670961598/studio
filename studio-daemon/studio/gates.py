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
    repo = CONFIG.lane(lane)["path"]
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
        log.write_text(f"GATE-TIMEOUT 600s\n{e}")
        proc = subprocess.CompletedProcess([], 124, "", "GATE-TIMEOUT")
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
