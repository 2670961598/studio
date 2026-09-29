"""org — 组织架构读层（ORG-DESIGN v2.2 / kernel/org.yaml 唯一事实源）。
P1 范围：加载/校验/等级双轨映射（L/G→1-9）/查询接口。
P2 接审批引擎（派单人终验收铁律+批干矩阵+联签），旧三机制成为 exemptions 特例。
分工定则：本模块管"人事与编制"；YouTrack 管"流程流转"（单据字段）。"""
import yaml
from pathlib import Path
from .config import CONFIG

ORG_PATH = CONFIG._root.parent / "kernel" / "org.yaml"

# 双轨映射：旧 L/G 级别 → 统一等级（渐进启用期两套并存，新字段优先）
LEVEL_MAP = {"L0 自动": 1, "L1 首批": 2, "L2 常规": 3, "L3 特护": 4,
             "G1 知识": 5, "G2 类型": 6, "G3 编制": 7, "G4 红线": 8}

_ORG = None


def load(force: bool = False) -> dict:
    """加载并轻校验 org.yaml（坏则返回 {}，不炸调用方——组织数据故障不拖垮引擎）。"""
    global _ORG
    if _ORG is not None and not force:
        return _ORG
    try:
        org = yaml.safe_load(ORG_PATH.read_text(encoding="utf-8")) or {}
        assert org.get("version") and org.get("projects")
        _ORG = org
    except Exception as e:
        print(f"[org] 加载失败回退空: {type(e).__name__} {e}")
        _ORG = {}
    return _ORG


def project(pid: str) -> dict:
    return (load().get("projects") or {}).get(pid) or {}


def level_of(track: str = "", ticket_level=None) -> int | None:
    """单据等级解析：YouTrack 等级字段（新）优先；空则按旧轨道映射（双轨）。"""
    if ticket_level is not None:
        try:
            return int(ticket_level)
        except (TypeError, ValueError):
            pass
    return LEVEL_MAP.get((track or "").strip())


def approve_ceiling(agent: str, pid: str) -> int:
    """agent 的批单上限（批干矩阵）：宰相=8（干9-? 特例：制作人派的9级单宰相主理但终验归制作人）。
    P2 由矩阵全量驱动；P1 先返回配置可表达的简化值。"""
    a = (project(pid).get("agents") or {}).get(agent)
    if not a:
        return 0
    lv = int(a.get("level") or 1)
    return max(0, min(lv + 1, 8))          # 干 [X,X+2] → 批上限 X+1（帽 8：9 恒制作人）


def producer_final(pid: str) -> bool:
    """铁律开关：派单人终验收（org 声明，引擎 P2 强制）。"""
    return bool((project(pid).get("approvals") or {}).get("派单人终验收"))
