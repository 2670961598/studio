"""statemachine — 状态迁移校验（唯一真源：kernel/schema/ticket-types.yaml 单子知识库）
知识库缺失/损坏时回退到内置硬编码（与 v1 等价），循环不因 schema 文件问题停摆。"""
import yaml
from pathlib import Path
from .config import CONFIG

SCHEMA_PATH = CONFIG._root.parent / "kernel" / "schema" / "ticket-types.yaml"


def _load_schema() -> dict:
    try:
        with open(SCHEMA_PATH, encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    except Exception:
        return {}


_S = _load_schema()


def _norm(track) -> str:
    t = (track or "").strip()
    if t in ("A 特护", "A", "a"):
        return "A"
    if t in ("C 轻轨", "C", "c"):
        return "C"
    return "B"


def _edges(key: str, schema_key: str) -> set[tuple[str, str]]:
    raw = _S.get(schema_key) or {}
    return {(a, b) for a, b in raw.get(key, [])}


def _type_edges() -> dict[str, set]:
    out = {}
    for k, v in (_S.get("type_edges") or {}).items():
        out[k] = {(a, b) for a, b in (v or [])}
    return out


def _common() -> set:
    if _S.get("common_edges"):
        return {(a, b) for a, b in _S["common_edges"]}
    return {  # 内置兜底（与知识库默认内容等价）
        ("开发中", "待测试"), ("待测试", "测试中"), ("已批准", "合并中"),
        ("合并中", "合并验证"), ("合并验证", "已关闭"),
        ("开发中", "已排期"), ("测试中", "已排期"),
        ("合并中", "已排期"), ("合并验证", "已排期")}


def _track(tr: str) -> set:
    key = {"A": "A 特护", "C": "C 轻轨"}.get(tr, "B 常规")
    if _S.get("track_edges"):
        return _edges(key, "track_edges")
    builtin = {
        "A": {("新单", "排期待审"), ("排期待审", "方案待审"), ("方案待审", "已排期"),
              ("测试中", "代码待审"), ("代码待审", "已批准"),
              ("合并验证", "待终验收"), ("待终验收", "已关闭")},
        "B": {("新单", "排期待审"), ("排期待审", "已排期"), ("测试中", "待合并"), ("待合并", "已批准")},
        "C": {("新单", "已排期"), ("测试中", "已批准")}}
    return builtin[tr]


TYPE_EDGES = _type_edges()

CANCELABLE = set((_S.get("states") or []) or [
    "草稿", "新单", "排期待审", "方案待审", "已排期", "开发中", "待测试", "测试中",
    "代码待审", "待合并", "已批准", "合并中", "合并验证", "待终验收", "研究中",
    "报告待审", "触发", "止血中", "待复盘", "复盘中"]) - {"已关闭", "已取消", "已归档"}


def allowed(frm: str, to: str, track, typ) -> bool:
    tr = _norm(track)
    if typ in TYPE_EDGES:                      # 专用流类型（情报/事故/战役…）
        edges = TYPE_EDGES[typ]
    else:                                      # 轨道制类型
        edges = _common() | _track(tr) | {("已排期", "开发中")}
    if to == "已取消" and frm in CANCELABLE:
        return True
    return (frm, to) in edges


PM_ACTIONABLE = ["草稿", "新单", "排期待审", "方案待审", "已排期", "开发中", "待测试",
                 "代码待审", "待合并", "已批准", "合并中", "合并验证", "待终验收"]
QA_CLAIMABLE = ["待测试"]

DIRECTIVES = {
    "approve-plan": {"排期待审": {"A": "方案待审", "B": "已排期", "C": "已排期"}},
    "approve-design": {"方案待审": {"A": "已排期", "B": "已排期", "C": "已排期"}},
    "approve-merge": {"待合并": {"B": "已批准", "C": "已批准"}, "代码待审": {"A": "已批准"}},
    "accept": {"待终验收": {"A": "已关闭", "B": "已关闭", "C": "已关闭"}},
}
