"""statemachine v2 — 五族分类 × 级别驱动的 AI 原生状态机（唯一真源：schema v2）
- 交付族：流由级别(L0-L3)展开，同名态可重复出现（L3 两段派发），合法性=沿各自序列走
- 知识/治理/运营/事件族：type_edges 专属边
- 退回边：证据就绪/复验通过 → 已派发（attempt+1 重做）
- 兜底：schema 文件损坏时回退内置（v2 等价）"""
import yaml
from pathlib import Path
from .config import CONFIG

SCHEMA_PATH = CONFIG._root.parent / "kernel" / "schema" / "ticket-types.yaml"

BUILTIN_LEVEL_FLOWS = {
    "L0 自动": ["新单", "已派发", "证据就绪", "复验通过", "已交付"],
    "L1 首批": ["新单", "待批", "已派发", "证据就绪", "复验通过", "已交付"],
    "L2 常规": ["新单", "待批", "已派发", "证据就绪", "复验通过", "待批", "已交付"],
    "L3 特护": ["新单", "待批", "已派发", "证据就绪", "待批", "已派发", "证据就绪",
               "复验通过", "待批", "已交付"],
}
BUILTIN_TYPE_EDGES = {
    "疑问": [("新单", "待答"), ("待答", "已答"), ("已答", "已沉淀")],
    "情报": [("发现", "评估中"), ("评估中", "已归档")],
    "提案": [("草稿", "待批"), ("待批", "实施中"), ("实施中", "观察窗"), ("观察窗", "结案")],
    "复盘": [("新单", "分析中"), ("分析中", "决议"), ("决议", "结案")],
    "战役": [("新单", "运行中"), ("运行中", "暂停"), ("暂停", "运行中")],
    "事故": [("发现", "止血中"), ("止血中", "复盘中"), ("复盘中", "已关闭")],
}
BUILTIN_ROLLBACK = [("证据就绪", "已派发"), ("复验通过", "已派发")]
BUILTIN_TYPES = {"需求", "缺陷", "技术债"}   # 交付族（走级别流）


def _load_schema() -> dict:
    try:
        with open(SCHEMA_PATH, encoding="utf-8") as f:
            s = yaml.safe_load(f) or {}
        assert s.get("types") and s.get("type_edges")
        return s
    except Exception:
        return {}


_S = _load_schema()


def recompute():
    """schema 变更后热重载（evolve._apply 调用；原子化重算全部派生表）。"""
    global _S, DELIVERY_TYPES, LEVEL_FLOWS, TYPE_EDGES, ROLLBACK
    _S = _load_schema()
    DELIVERY_TYPES = ({k for k, v in (_S.get("types") or {}).items()
                       if (v or {}).get("族") == "交付"} or BUILTIN_TYPES)
    LEVEL_FLOWS = {k: list(v) for k, v in (_S.get("flow_by_level") or BUILTIN_LEVEL_FLOWS).items()}
    TYPE_EDGES = {k: [tuple(e) for e in v]
                  for k, v in (_S.get("type_edges") or BUILTIN_TYPE_EDGES).items()}
    ROLLBACK = [tuple(e) for e in (_S.get("rollback_edges") or BUILTIN_ROLLBACK)]


DELIVERY_TYPES = {k for k, v in (_S.get("types") or {}).items()
                  if (v or {}).get("族") == "交付"} or BUILTIN_TYPES
LEVEL_FLOWS = {k: list(v) for k, v in (_S.get("flow_by_level") or BUILTIN_LEVEL_FLOWS).items()}
TYPE_EDGES = {k: [tuple(e) for e in v]
              for k, v in (_S.get("type_edges") or BUILTIN_TYPE_EDGES).items()}
ROLLBACK = [tuple(e) for e in (_S.get("rollback_edges") or BUILTIN_ROLLBACK)]


def _norm_level(track) -> str:
    t = (track or "").strip()
    for lv in LEVEL_FLOWS:
        if t.startswith(lv.split()[0]) or t == lv:
            return lv
    # 旧值映射（历史单）
    return {"A": "L3 特护", "B": "L2 常规", "C": "L0 自动"}.get(t[:1] if t else "", "L2 常规")


def _flow(track, typ) -> list[str] | None:
    if typ in DELIVERY_TYPES:
        return LEVEL_FLOWS.get(_norm_level(track))
    return None


def allowed(frm: str, to: str, track, typ) -> bool:
    if to == "已取消":
        return frm not in ("已交付", "已关闭", "已归档", "已取消", "结案")
    flow = _flow(track, typ)
    if flow:  # 交付族：沿序列相邻可走（同名态重复时，允许任何相邻同名迁移）
        if (frm, to) in [(flow[i], flow[i + 1]) for i in range(len(flow) - 1)]:
            return True
        if (frm, to) in ROLLBACK and frm in flow:
            return True
        return False
    edges = TYPE_EDGES.get(typ)
    if edges:
        return (frm, to) in edges or (frm, to) in ROLLBACK
    return False


def next_states(frm: str, track, typ) -> list[str]:
    flow = _flow(track, typ)
    if flow:
        idx = [i for i, s in enumerate(flow) if s == frm]
        out = {flow[i + 1] for i in idx if i + 1 < len(flow)}
        out |= {b for a, b in ROLLBACK if a == frm}
        return sorted(out)
    return sorted({b for a, b in (TYPE_EDGES.get(typ) or []) if a == frm})


# daemon 视角的活动态集合（pm_tick 轮询范围）
PM_ACTIONABLE = ["新单", "待批", "已派发", "证据就绪", "复验通过", "草稿", "发现"]
QA_CLAIMABLE = []   # v2 无独立待测试态：复验由 daemon 在"证据就绪"收割时内联执行

# 制作人批示 → 按位置语义映射（v2：待批在流中的位置决定它批的是什么）
def directive_target(frm: str, track, typ, directive: str) -> str | None:
    """返回批示应迁移到的目标态；None=指令不适用当前位置。"""
    flow = _flow(track, typ)
    if not flow or frm != "待批":
        return None
    idx = flow.index("待批")          # 第一个待批（立项/方案类）
    if directive == "approve-plan":
        return flow[flow.index("待批") + 1]
    if directive == "approve-merge":
        # L2/L3 的最后一个待批 → 已交付
        last = len(flow) - 1 - flow[::-1].index("待批")
        return flow[last + 1] if flow.index("待批") == last and frm == "待批" else None
    if directive == "approve-design":  # L3 第二个待批（方案）
        return flow[flow.index("待批", flow.index("待批") + 1) + 1] \
            if flow.count("待批") > 1 else None
    return None
