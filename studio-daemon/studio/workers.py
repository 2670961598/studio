"""workers — Claude Code 工人进程管理（吸收 studio-worker，升级 stream-json 直播）
- launch: 组装自包含任务书 → nohup claude -p --output-format stream-json 落盘直播
- 知识库（STUDIO-13 起）迁 YouTrack Articles：launch 时 fetch_profile 拉公约/角色档案/手册注入任务书
- status: DONE(REPORT 落盘) / RUNNING(pid) / DEAD
- 证据链与 bash 版完全兼容：kernel/workers/<单号>.json / .REPORT.md / .stream.jsonl
"""
import json, os, subprocess, time
from pathlib import Path
from .config import CONFIG

# 提示词版本次号（STUDIO-47E）：改 WORKER_TEMPLATE 必须同步 +1 并在 git commit 里写明改因
# ——打回率按版本归因的地基（与 STUDIO-43 复盘闭环联动）。
# W-2026-09-30.1（STUDIO-82）：注入 org.yaml 人事四要素（部门/角色/职责/上级），
# 占位 {org_profile} 紧贴 {profile} 行尾——无档案时为空串，任务书与旧版逐字节一致。
# W-2026-09-30.2（STUDIO-77 撞号化解）：30.1 与「第 5 条删 Bearer 直发教学、Article
# 唯一路径=网关 /api/yt/article」两改因分头升过同名次号，合并时按次号纪律 +1 归并一版。
PROMPT_VERSION = "W-2026-09-30.2"

WIKI_TEAM = "全局/团队公约"
WIKI_WORKER_PROFILE = "编制/worker"                  # 三类 worker（dev/designer/artist）共用执行层档案
WIKI_COMMON = "手册/worker-common"
LEGACY_FILES = {                                     # YouTrack 不可达时的本地兜底（迁移前旧路径，git 历史可考）
    WIKI_TEAM: Path("/Volumes/BigDisk/Studio/kernel/TEAM.md"),
    WIKI_WORKER_PROFILE: Path("/Volumes/BigDisk/Studio/kernel/agents/worker.md"),
    WIKI_COMMON: Path("/Volumes/BigDisk/Studio/kernel/skills/worker-common.md"),
}


def fetch_profile(yt, wiki_path: str) -> str:
    """从 YouTrack Articles 拉知识库档案（唯一事实源）；拉不到回退本地旧文件，再没有给空串。"""
    try:
        return yt.wiki_get(wiki_path)
    except Exception:
        fb = LEGACY_FILES.get(wiki_path)
        return fb.read_text(encoding="utf-8") if fb and fb.exists() else ""


def org_profile_block(identity: str, pid: str = "STUDIO") -> str:
    """org.yaml agents 人事档案 → 任务书注入块（STUDIO-82：部门/角色/职责/上级四要素）。
    无档案或无部门 → ""（{org_profile} 占位随之消失，任务书与注入前逐字节一致——行为不变）。"""
    from . import org
    p = org.agent_profile(identity, pid)
    if not p or not p.get("部门"):
        return ""
    up = p.get("上级")
    up_s = "、".join(str(u) for u in up) if isinstance(up, list) else str(up or "（未登记）")
    return (f"\n\n# ══════ 人事档案（kernel/org.yaml agents 段，唯一事实源）══════\n"
            f"- 部门: {'、'.join(p['部门'])}\n"
            f"- 角色: {p['角色'] or '（未登记）'}\n"
            f"- 职责: {'；'.join(p['职责']) or '（未登记）'}\n"
            f"- 上级: {up_s}\n"
            f"（职责以部门职能为边界；与单据要求冲突或需越界时，报上列上级裁决，不自行扩权。）")


WORKER_TEMPLATE = """你是虚拟工作室的 {title}（身份 {role}），以独立 Claude Code 进程完成单据 {issue}，一单一命。
团队公约、角色档案、worker 手册已从 YouTrack Articles 拉取并注入下方（知识库唯一事实源），
开工先通读（尤其公约"成员名册"中你的权限边界），再读目标仓库的 AGENTS.md（如有）。

# ══════ 团队公约（Articles: {wteam}）══════
{team}

# ══════ 角色档案（Articles: 编制/worker）══════
{profile}{org_profile}

# ══════ worker 通用手册（Articles: {wcommon}）══════
{common}

## 单据
- 标题: {summary}
- 需求描述:
{desc}
- 轨道: {track} ｜ 泳道: {lane} ｜ Type: {type} ｜ attempt: {attempt}
- 冻结验收命令（完成判据，禁止改动）: {gate}

## 制作人批注（来自评论区，优先级高于描述）
{producer_notes}

## 执行要求
1. 仓库: {repo} ｜ 工作分支: {branch}（已建好，先 checkout）。只在此分支提交，提交信息格式照手册。
2. 心跳：每完成一个阶段执行一次 `curl -s -X POST http://{gwhost}/api/yt/heartbeat -H 'Content-Type: application/json' -d "{{\"iid\":\"{issue}\",\"key\":\"$STUDIO_WKEY\"}}"`（YouTrack 一律走此网关；禁止读取 youtrack.json/token——越权即拒，状态推进不归你）。
3. 完工自检：自跑冻结验收命令，绿了才算完。
4. 交付：把 REPORT（格式照手册）全文写入 {report} —— 唯一交付物。不要写板面单据状态，不要 push。
5. 过程沉淀：bug 修复过程/意外发现/来不及做的优化/有趣发现 → 写 Article 草稿留档
   （唯一合法路径是网关：`curl -s -X POST http://{gwhost}/api/yt/article -H 'Content-Type: application/json' -d "{{\"iid\":\"{issue}\",\"key\":\"$STUDIO_WKEY\",\"title\":\"<标题>\",\"content\":\"<正文>\"}}"`，
   网关自动署名 [项目·单号·worker] 并记账，PM 巡田时收割转正。
   直连 YouTrack 的任何端点一律禁止（无 token、不教用法，越权即拒）；绝不读取 youtrack.json/token）。
6. 项目知识按需查（两层知识分离：全局公约已注入上文，项目知识不预注入）：
   `curl -s -G "http://{gwhost}/api/yt/kb-search" --data-urlencode "iid={issue}" --data-urlencode "key=$STUDIO_WKEY" --data-urlencode "q=<关键词>" --data-urlencode "project=<PID>"`
   （只读检索，标题/正文含关键词的 Articles top5：path/id/excerpt；-G --data-urlencode 免中文转码）。
"""


# 执行器规格表（STUDIO-47C）：lane 可配 executor 字段选择执行 CLI。
# 新执行器接入纪律：参数面必须先在沙箱真实验证（--model/预算/输出格式映射），
# 未登记的执行器启动即报错，绝不静默降级跑错命令。
EXECUTOR_SPECS = {
    "claude": {
        "args": "-p --dangerously-skip-permissions --output-format stream-json --verbose "
                '--model "{model}" --max-budget-usd {budget}',
    },
}


def executor_cmdline(executor: str, prompt, stream) -> str:
    spec = EXECUTOR_SPECS.get(executor)
    if not spec:
        known = ", ".join(EXECUTOR_SPECS)
        raise RuntimeError(f"未知执行器 {executor!r}（已登记：{known}）——"
                           f"新执行器须先在沙箱验证参数面并登记 EXECUTOR_SPECS")
    return spec["args"].format(model=CONFIG.worker_model,
                               budget=CONFIG.worker_max_budget_usd) \
        + f' < "{prompt}" > "{stream}" 2>&1'


def wrap_script(issue: str, repo: str, prompt, stream, claude_bin: str,
                executor: str = "claude", wkey: str = "") -> str:
    """wrap 生成（纯函数便于测试）。约束三件套（审计 P0-3）：固定模型 + 预算帽 +
    wall-clock 看门狗。多执行器（STUDIO-47C）：命令行由 EXECUTOR_SPECS 按执行器映射。
    wkey（STUDIO-79 修复）：派单签发的网关凭证导出给 worker 进程——YouTrack 网关
    （ytgw.verify，STUDIO-77 起三类执行体统一）读 reg 里的 wkey 认证，
    任务书教的 curl 用 $STUDIO_WKEY。"""
    return f"""#!/bin/bash
cd "{repo}"
git checkout feature/{issue} >/dev/null 2>&1
export STUDIO_WKEY="{wkey}"
export ANTHROPIC_BASE_URL="https://open.bigmodel.cn/api/zcode-plan/anthropic"
# ↑ STUDIO-110: zcode-plan 端点 ×0.67 倍率（ZCode 工具通道）——worker 专用
{claude_bin} {executor_cmdline(executor, prompt, stream)} &
CPID=$!
( sleep {CONFIG.worker_wall_timeout_s}; kill -TERM $CPID 2>/dev/null ) & WDOG=$!
wait $CPID; RC=$?
kill $WDOG 2>/dev/null
echo "WORKER-EXIT=$RC" >> "{stream}"
"""


def _role(typ: str) -> tuple[str, str]:
    if typ == "策划":
        return "agent-6", "策划 worker"
    if typ == "美术":
        return "agent-5", "美术 worker"
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
        from .llm import _claude_bin
        t = YT("agent-8")
        lane = lane or ticket["fields"].get("泳道") or "core"
        lc = CONFIG.lane(lane)
        claude_bin = _claude_bin()                # wrap 在守护进程环境跑，PATH 里没有 claude，必须写绝对路径
        role, title = _role(ticket["fields"].get("Type") or "需求")
        # 拉制作人评论（过滤掉纯指令词，保留有内容的批注）
        comments = t.comments(self.issue)
        directive_words = {"approve", "approve-plan", "approve-merge", "approve-design",
                          "reject", "kill", "promote", "track", "批准", "同意", "通过",
                          "否决", "取消", "杀", "转正", "开始吧"}
        producer_notes = []
        for c in comments:
            if c["author"] != "opengames":
                continue
            text = c["text"].strip()
            first = text.split("，")[0].split(",")[0].split("。")[0].strip()
            if first in directive_words:
                continue  # 纯指令，worker 不需要
            producer_notes.append(f"- {text}")
        notes = "\n".join(producer_notes) if producer_notes else "（无额外批注）"
        team = fetch_profile(t, WIKI_TEAM)            # 知识库在 Articles（STUDIO-13 迁移）
        profile = fetch_profile(t, WIKI_WORKER_PROFILE)
        common = fetch_profile(t, WIKI_COMMON)
        org_blk = org_profile_block(role)             # org.yaml 人事四要素（无档案→空，行为不变）

        prompt = WORKER_TEMPLATE.format(
            issue=self.issue, title=title, role=role, summary=ticket["summary"],
            desc=ticket["description"], track=ticket["fields"].get("轨道") or "L2 常规",
            lane=lane, type=ticket["fields"].get("Type") or "需求",
            attempt=ticket["fields"].get("attempt") or 0,
            gate=ticket["fields"].get("验收命令"), repo=lc["path"],
            branch=f"feature/{self.issue}",
            report=self.report, producer_notes=notes,
            wteam=WIKI_TEAM, team=team, profile=profile, org_profile=org_blk,
            wcommon=WIKI_COMMON, common=common,
            gwhost=f"{CONFIG.web_host}:{CONFIG.web_port}")
        self.prompt.write_text(prompt)
        # 清上一轮残留（退回重派时旧 REPORT 会被误判 DONE）
        att = int(ticket["fields"].get("attempt") or 0)
        for f in (self.report, self.stream):
            if f.exists():
                f.rename(f.with_name(f"{f.stem}.a{att}{f.suffix}"))
        # STUDIO-79 修复：派单即签发网关凭证（reg 钉存 + wrap 导出）——
        # 此前 web 网关收权（ac12fe1）只建了校验端，签发端从未接线，worker 心跳/评论/文章全 403
        # STUDIO-77：签发统一进 ytgw.sign（交付/explore worker 与 patrol 巡逻岛同一形态），
        # 校验收敛为 ytgw.verify（web HTTP 面薄壳化）
        from . import ytgw
        wkey = ytgw.sign()
        self.wrap.write_text(wrap_script(self.issue, lc["path"], self.prompt, self.stream,
                                         claude_bin, executor=lc.get("executor", "claude"),
                                         wkey=wkey))
        self.wrap.chmod(0o755)
        proc = subprocess.Popen(["nohup", "bash", str(self.wrap)], stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL, start_new_session=True)
        pid = proc.pid                            # wrap 即 session leader（pgid=pid）
        import hashlib as _hl
        _sha8 = _hl.sha256(prompt.encode("utf-8")).hexdigest()[:8]
        reg = {"issue": self.issue, "pid": pid, "lane": lane,
               "branch": f"feature/{self.issue}", "repo": lc["path"],
               "base": lc["base_branch"], "report": str(self.report),
               "stream": str(self.stream), "started": time.strftime("%F %T"),
               "prompt_ver": PROMPT_VERSION, "prompt_sha8": _sha8,
               "wkey": wkey}                      # STUDIO-79 修复：网关凭证钉进 reg（签发断链曾致 worker 心跳全 403）
        self.reg.write_text(json.dumps(reg, ensure_ascii=False))
        # 版本登记（append-only）：版本×单号×哈希——周报按此归因打回率
        with open(CONFIG.events_path.parent / "prompts.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps({"ts": reg["started"], "issue": self.issue,
                                "ver": PROMPT_VERSION, "sha8": _sha8},
                               ensure_ascii=False) + "\n")
        return pid

    def reg_data(self) -> dict | None:
        if self.reg.exists():
            return json.loads(self.reg.read_text())
        done = CONFIG.workers_dir / f"{self.issue}.done.json"
        if done.exists():
            return json.loads(done.read_text())
        return None

    def status(self) -> str:
        """DONE=REPORT 落盘｜RUNNING=wrap 进程活｜ARCHIVED=本轮已收割（待重派）｜DEAD=进程亡未交卷。"""
        if self.report.exists():
            return f"DONE {self.report}"
        if not self.reg.exists():
            if self.reg.with_name(f"{self.issue}.done.json").exists():
                return "ARCHIVED"                  # 已收割处理过：等编排器重派
            return "UNKNOWN"
        reg = json.loads(self.reg.read_text())
        if reg.get("pid", -1) <= 0:
            return "DEAD pid=invalid"
        try:
            os.kill(reg["pid"], 0)
            m = int((time.time() - self.reg.stat().st_mtime) // 60)
            return f"RUNNING {reg['pid']} {m}min"
        except (ProcessLookupError, ValueError):
            return f"DEAD pid={reg['pid']}（看 {reg['stream']}）"

    def wait_dead(self, timeout_s: float = 15) -> bool:
        """kill 后轮询进程组确认死亡（审计 P1-7：不等死就重派=垂死 worker 与新 worker
        同分支并发写）。True=已死；False=超时（调用方记录并放弃本拍重派，下拍再来）。"""
        import os as _os, time as _t
        reg = self.reg_data()
        pid = (reg or {}).get("pid", -1)
        if pid <= 0:
            return True
        deadline = _t.time() + timeout_s
        while _t.time() < deadline:
            try:
                _os.kill(pid, 0)
            except (ProcessLookupError, PermissionError):
                return True                      # PermissionError=僵尸态待收，同样视为不可写
            _t.sleep(1)
        return False

    def kill(self, escalate: bool = False) -> str:
        reg = self.reg_data()
        if not reg or reg["pid"] < 0:
            return "UNKNOWN"
        import signal
        sig = signal.SIGKILL if escalate else signal.SIGTERM
        tag = "KILL9" if escalate else "KILLED"
        try:  # wrap 以 session leader 启动，杀整组连 claude 及其孙进程一起收
            os.killpg(reg["pid"], sig)
            return f"{tag} {self.issue} (pgid={reg['pid']})"
        except (ProcessLookupError, PermissionError):
            try:
                os.kill(reg["pid"], sig)
                return f"{tag} {self.issue} (pid={reg['pid']})"
            except ProcessLookupError:
                return f"NOT-ALIVE {self.issue}"

    def result_stats(self) -> dict:
        """stream 末尾 result 事件 → 记账三元组（成本/时长/tokens）。
        不同 claude 版本字段名漂移：duration_ms 与 duration_api_ms 都认。
        缺文件/无 result 事件/坏行 → {}（记账缺失不致命，事实留白）。"""
        if not self.stream.exists():
            return {}
        # 逐行容错（生产实录：wrap 末尾恒有 WORKER-EXIT=0 非 JSON 行，
        # 循环外 try 曾让解析整桶放弃——记账接线因此静默失效一天）
        for ln in reversed(self.stream.read_text(
                encoding="utf-8", errors="replace").splitlines()[-10:]):
            try:
                e = json.loads(ln)
            except Exception:
                continue
            if e.get("type") == "result":
                u = e.get("usage") or {}
                toks = (u.get("input_tokens") or 0) + (u.get("output_tokens") or 0)
                return {"cost_usd": e.get("total_cost_usd"),
                        "duration_ms": e.get("duration_ms") or e.get("duration_api_ms"),
                        "tokens": toks or None, "turns": e.get("num_turns"),
                        "session_id": e.get("session_id"),
                        "is_error": e.get("is_error", False)}
        return {}

    def archive(self):
        """收割处理完毕：reg 与产物全部归档（防旧 REPORT 反复触发 DONE）。
        归档前把 result 记账三元组钉进 done.json——stream 改名后记账/面板仍可读。"""
        rs = self.result_stats()
        if self.reg.exists():
            try:
                reg = json.loads(self.reg.read_text(encoding="utf-8"))
            except Exception:
                reg = {}
            reg["result"] = rs
            (CONFIG.workers_dir / f"{self.issue}.done.json").write_text(
                json.dumps(reg, ensure_ascii=False), encoding="utf-8")
            self.reg.unlink()
        att = time.strftime("%H%M%S")
        for f in (self.report, self.stream):
            if f.exists():
                f.rename(f.with_name(f"{f.stem}.archived-{att}{f.suffix}"))
