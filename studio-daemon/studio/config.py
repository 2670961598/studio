"""config — 工作室 daemon 配置装载（单一真源：复用现有 json 配置，不搬家）"""
import json, os
from pathlib import Path

STUDIO_ROOT = Path("/Volumes/BigDisk/Studio")
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
        self.max_attempts = 3
        self.heartbeat_timeout_min = 90
        self.lane_lock_ttl_min = 120
        self.tick_lock_ttl_min = 240
        self.web_port = int(os.environ.get("STUDIO_PORT", "8787"))
        self.workers_dir.mkdir(parents=True, exist_ok=True)

    # ---- 便捷访问 ----
    @property
    def yt_url(self) -> str:
        return self.yt_cfg["url"].rstrip("/")

    def token(self, acct: str) -> str:
        if acct == "admin":
            return self.yt_cfg["admin_token"]
        return self.yt_cfg["agents"][acct]["token"]

    def lane(self, name: str) -> dict:
        return self.lanes[name]

    def proj_id(self, pid: str) -> str:
        return self.projects[pid]


CONFIG = Config()
