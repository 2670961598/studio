"""workers — Claude Code 工人进程管理（吸收 studio-worker，升级 stream-json 直播）
- launch: 组装自包含任务书 → nohup claude -p --output-format stream-json 落盘直播
- status: DONE(REPORT 落盘) / RUNNING(pid) / DEAD
- 证据链与 bash 版完全兼容：kernel/workers/<单号>.json / .REPORT.md / .stream.jsonl
"""
import json, os, subprocess, time
from pathlib import Path
from .config import CONFIG

WORKER_TEMPLATE = """你是虚拟工作室的 {title}（身份 {role}），以独立 Claude Code 进程完成单据 {issue}，一单一命。
先读手册 /Volumes/BigDisk/Studio/kernel/skills/worker-common.md（唯一规范），再读目标仓库的 AGENTS.md（如有）。

## 单据
- 标题: {summary}
- 需求描述:
{desc}
- 轨道: {track} ｜ 泳道: {lane} ｜ Type: {type} ｜ attempt: {attempt}
- 冻结验收命令（完成判据，禁止改动）: {gate}

## 执行要求
1. 仓库: {repo} ｜ 工作分支: {branch}（已建好，先 checkout）。只在此分支提交，提交信息格式照手册。
2. 心跳：每完成一个阶段执行一次 `YT_ACCT={wacct} ~/bin/yt heartbeat {issue}`。
3. 完工自检：自跑冻结验收命令，绿了才算完。
4. 交付：把 REPORT（格式照手册）全文写入 {report} —— 唯一交付物。不要写 YouTrack，不要 push。
"""


def _role(typ: str) -> tuple[str, str]:
    if typ == "策划":
        return "agent-designer", "策划 worker"
    if typ == "美术":
        return "agent-artist", "美术 worker"
    return "agent-dev", "程序 worker"


class Worker:
    def __init__(self, issue: str):
        self.issue = issue
        self.reg = CONFIG.workers_dir / f"{issue}.json"
        self.report = CONFIG.workers_dir / f"{issue}.REPORT.md"
        self.prompt = CONFIG.workers_dir / f"{issue}.prompt.md"
        self.stream = CONFIG.workers_dir / f"{issue}.stream.jsonl"
        self.wrap = CONFIG.workers_dir / f"{issue}.wrap.sh"

    def launch(self, ticket: dict, lane: str | None = None) -> int:
        from .yt import YT
        t = YT("agent-pm")
        lane = lane or ticket["fields"].get("泳道") or "core"
        lc = CONFIG.lane(lane)
        role, title = _role(ticket["fields"].get("Type") or "业务")
        prompt = WORKER_TEMPLATE.format(
            issue=self.issue, title=title, role=role, summary=ticket["summary"],
            desc=ticket["description"], track=ticket["fields"].get("轨道") or "B 常规",
            lane=lane, type=ticket["fields"].get("Type") or "业务",
            attempt=ticket["fields"].get("attempt") or 0,
            gate=ticket["fields"].get("验收命令"), repo=lc["path"],
            branch=f"feature/{self.issue}", wacct=lc.get("yt_acct", "agent-core"),
            report=self.report)
        self.prompt.write_text(prompt)
        self.wrap.write_text(f"""#!/bin/bash
cd "{lc['path']}"
git checkout feature/{self.issue} >/dev/null 2>&1
claude -p --dangerously-skip-permissions --output-format stream-json --verbose < "{self.prompt}" > "{self.stream}" 2>&1
echo "WORKER-EXIT=$?" >> "{self.stream}"
""")
        self.wrap.chmod(0o755)
        subprocess.Popen(["nohup", "bash", str(self.wrap)], stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL, start_new_session=True)
        time.sleep(0.5)
        # 找 wrap 的 pid（pgrep 按 wrap 文件名匹配，足够唯一）
        pid = subprocess.run(["pgrep", "-f", str(self.wrap)], capture_output=True,
                             text=True).stdout.split()
        reg = {"issue": self.issue, "pid": int(pid[0]) if pid else -1, "lane": lane,
               "branch": f"feature/{self.issue}", "repo": lc["path"],
               "base": lc["base_branch"], "report": str(self.report),
               "stream": str(self.stream), "started": time.strftime("%F %T")}
        self.reg.write_text(json.dumps(reg, ensure_ascii=False))
        return reg["pid"]

    def reg_data(self) -> dict | None:
        if self.reg.exists():
            return json.loads(self.reg.read_text())
        done = CONFIG.workers_dir / f"{self.issue}.done.json"
        if done.exists():
            return json.loads(done.read_text())
        return None

    def status(self) -> str:
        reg = self.reg_data()
        if not reg:
            return "UNKNOWN"
        if self.report.exists():
            return f"DONE {self.report}"
        try:
            os.kill(reg["pid"], 0)
            m = int((time.time() - self.reg.stat().st_mtime) // 60)
            return f"RUNNING {reg['pid']} {m}min"
        except (ProcessLookupError, ValueError):
            return f"DEAD pid={reg['pid']}（看 {reg['stream']}）"

    def kill(self) -> str:
        reg = self.reg_data()
        if not reg or reg["pid"] < 0:
            return "UNKNOWN"
        import signal
        try:  # wrap 以 session leader 启动，杀整组连 claude 及其孙进程一起收
            os.killpg(reg["pid"], signal.SIGTERM)
            return f"KILLED {self.issue} (pgid={reg['pid']})"
        except (ProcessLookupError, PermissionError):
            try:
                os.kill(reg["pid"], signal.SIGTERM)
                return f"KILLED {self.issue} (pid={reg['pid']})"
            except ProcessLookupError:
                return f"NOT-ALIVE {self.issue}"

    def archive(self):
        if self.reg.exists():
            self.reg.rename(CONFIG.workers_dir / f"{self.issue}.done.json")
