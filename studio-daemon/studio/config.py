"""config — 工作室 daemon 配置装载（单一真源：复用现有 json 配置，不搬家）"""
import json, os
from pathlib import Path

# 根路径可被环境变量改写（实验场隔离：同一份代码，另一套 kernel 状态；
# 生产不设此变量，恒为 /Volumes/BigDisk/Studio）
STUDIO_ROOT = Path(os.environ.get("STUDIO_ROOT", "/Volumes/BigDisk/Studio"))
KERNEL = STUDIO_ROOT / "kernel"
POLYCFG = Path.home() / ".config/polymatch3"


def _load(p: Path) -> dict:
    with open(p, encoding="utf-8") as f:
        return json.load(f)


class Config:
    def __init__(self):
        self._root = Path(__file__).resolve().parent.parent  # studio-daemon/
        self.yt_cfg = _load(POLYCFG / "youtrack.json")          # {url, admin_token, agents{acct:{token}}}
        self.lanes = _load(POLYCFG / "studio.json")["lanes"]    # {lane:{path,base_branch,agent,yt_acct}}
        self.ids = _load(KERNEL / "youtrack-ids.json")          # {projects{PID:projId}, fields, ...}
        self.projects: dict[str, str] = self.ids["projects"]
        # 运行时目录（与 bash 内核共享，格式兼容）
        self.locks_dir = KERNEL / "locks"
        self.workers_dir = KERNEL / "workers"
        self.evidence_dir = KERNEL / "evidence"
        self.heartbeats_dir = KERNEL / "heartbeats"
        self.logs_dir = KERNEL / "logs"
        self.events_path = KERNEL / "metrics" / "events.jsonl"
        self.digest_dir = KERNEL / "metrics" / "digest"
        for d in (self.locks_dir, self.workers_dir, self.evidence_dir,
                  self.heartbeats_dir, self.logs_dir, self.digest_dir):
            d.mkdir(parents=True, exist_ok=True)
        self.producer = "opengames"
        # 制作人委托代批：
        # - GAMES（2026-09-22）"只需要一直批准"——无条件放行
        # - POLY（2026-09-26）"你直接审查之后，可以的进行同意即可"——ZCode 常驻监督
        #   逐单审查后代批，批准评论必须附审查意见留痕；非无条件
        # - STUDIO（2026-09-27）"全部开发你直接审核"——未来探索/开发需求/bug
        #   处置由 ZCode 审核放行（须附审查意见）；宪章与红线修改仍只认制作人
        self.delegated_approvals: dict[str, list[str]] = {"GAMES": ["agent-8"],
                                                          "POLY": ["agent-8"],
                                                          "STUDIO": ["agent-8"]}
        # 亲批泳道（制作人 2026-09-28 指令：三消 core 仓迭代多版、重要度最高，
        # 慎之又慎——该泳道单据一切批示只认制作人，代批账号的批准不被消费）
        self.producer_only_lanes: dict[str, list[str]] = {"POLY": ["core"]}
        # fail-safe（2026-09-28）：委托账号未在 youtrack.json 注册 token 时自动剔除并告警
        # ——代批账号切 agent-9 后，token 未就位前不会 401 崩溃，只是该账号暂不可代批
        _ag = self.yt_cfg.get("agents", {})
        for _p, _accts in list(self.delegated_approvals.items()):
            _ok = [a for a in _accts if a in _ag and _ag[a].get("token")]
            if len(_ok) != len(_accts):
                print(f"[config] 委托账号缺 token 剔除：{_p} {_accts}→{_ok}（youtrack.json 注册后自动恢复）")
                self.delegated_approvals[_p] = _ok
        self.max_attempts = 3
        self.heartbeat_timeout_min = 90
        self.lane_lock_ttl_min = 120
        self.tick_lock_ttl_min = 240
        # worker 约束三件套（宪章 §4.6/§6；审计 P0-3——曾只修在已废弃的 bash 脚本上）
        self.worker_model = os.environ.get("WORKER_MODEL", "glm-5.3")
        self.worker_max_budget_usd = float(os.environ.get("WORKER_MAX_BUDGET", "15"))
        self.worker_wall_timeout_s = int(os.environ.get("WORKER_WALL_TIMEOUT", "2700"))
        self.web_port = int(os.environ.get("STUDIO_PORT", "8787"))
        self.workers_dir.mkdir(parents=True, exist_ok=True)

    # ---- 便捷访问 ----
    @property
    def panel_token(self) -> str:
        """面板 POST 令牌：env STUDIO_PANEL_TOKEN 优先；否则首用生成并持久化到
        ~/.config/polymatch3/panel-token（凭证目录，绝不入仓）。"""
        import secrets
        env = os.environ.get("STUDIO_PANEL_TOKEN")
        if env:
            return env
        f = POLYCFG / "panel-token"
        if f.exists():
            return f.read_text(encoding="utf-8").strip()
        tok = "pt-" + secrets.token_hex(24)
        f.write_text(tok + "\n", encoding="utf-8")
        f.chmod(0o600)
        return tok

    @property
    def yt_url(self) -> str:
        return self.yt_cfg["url"].rstrip("/")

    def token(self, acct: str) -> str:
        if acct == "admin":
            return self.yt_cfg["admin_token"]
        return self.yt_cfg["agents"][acct]["token"]

    def lane(self, name: str) -> dict:
        return self.lanes[name]

    def is_approver(self, pid: str, author: str) -> bool:
        """批示授权谓词：制作人恒真；委托表内的项目允许指定账号代批（可审计）。"""
        return author == self.producer or author in self.delegated_approvals.get(pid, [])

    def can_approve(self, pid: str, author: str, lane: str | None) -> bool:
        """含泳道豁免的批准谓词：亲批泳道（producer_only_lanes）内制作人之外一律无效。"""
        if author == self.producer:
            return True
        if lane and lane in self.producer_only_lanes.get(pid, []):
            return False
        return author in self.delegated_approvals.get(pid, [])

    def proj_id(self, pid: str) -> str:
        return self.projects[pid]


CONFIG = Config()
