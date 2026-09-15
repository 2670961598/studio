"""statemachine — 轨道×类型状态迁移矩阵（Python 唯一真源，移植自 ~/bin/yt trans_ok）
23 态全集；违规迁移一律拒绝——LLM 与人都不许跳态/串轨。"""


def _norm(track: str | None) -> str:
    t = (track or "").strip()
    if t in ("A 特护", "A", "a"):
        return "A"
    if t in ("C 轻轨", "C", "c"):
        return "C"
    return "B"


COMMON = {
    ("开发中", "待测试"), ("待测试", "测试中"), ("已批准", "合并中"),
    ("合并中", "合并验证"), ("合并验证", "已关闭"),
    # 退回边（attempt+1 后重排）
    ("开发中", "已排期"), ("测试中", "已排期"), ("合并中", "已排期"), ("合并验证", "已排期"),
}
A_EDGES = {
    ("新单", "排期待审"), ("排期待审", "方案待审"), ("方案待审", "已排期"),
    ("测试中", "代码待审"), ("代码待审", "已批准"),
    ("合并验证", "待终验收"), ("待终验收", "已关闭"),
}
B_EDGES = {
    ("新单", "排期待审"), ("排期待审", "已排期"),
    ("测试中", "待合并"), ("待合并", "已批准"),
}
C_EDGES = {("新单", "已排期"), ("测试中", "已批准")}
INTEL_EDGES = {("草稿", "新单"), ("新单", "研究中"), ("研究中", "报告待审"), ("报告待审", "已归档")}
INCIDENT_EDGES = {("触发", "止血中"), ("止血中", "待复盘"), ("待复盘", "复盘中"), ("复盘中", "已关闭")}
CANCELABLE = {
    "草稿", "新单", "排期待审", "方案待审", "已排期", "开发中", "待测试", "测试中",
    "代码待审", "待合并", "已批准", "合并中", "合并验证", "待终验收", "研究中",
    "报告待审", "触发", "止血中", "待复盘", "复盘中",
}


def allowed(frm: str, to: str, track: str | None, typ: str | None) -> bool:
    tr = _norm(track)
    edges = set(COMMON)
    if typ == "情报":
        edges |= INTEL_EDGES
    elif typ == "事故":
        edges |= INCIDENT_EDGES
    else:
        edges |= {("已排期", "开发中")}
        edges |= A_EDGES if tr == "A" else C_EDGES if tr == "C" else B_EDGES
    if to == "已取消" and frm in CANCELABLE:
        return True
    return (frm, to) in edges


# 各角色关心的活动态（轮询用）
PM_ACTIONABLE = ["草稿", "新单", "排期待审", "方案待审", "已排期", "开发中", "待测试",
                 "代码待审", "待合并", "已批准", "合并中", "合并验证", "待终验收"]
QA_CLAIMABLE = ["待测试"]
# 生产者批示 → (适用状态, 目标状态)；track A|B|C 与 reject/kill 等特殊指令在 orchestrator 处理
DIRECTIVES = {
    "approve-plan": {"排期待审": {"A": "方案待审", "B": "已排期", "C": "已排期"}},
    "approve-design": {"方案待审": {"A": "已排期", "B": "已排期", "C": "已排期"}},
    "approve-merge": {"待合并": {"B": "已批准", "C": "已批准"}, "代码待审": {"A": "已批准"}},
    "accept": {"待终验收": {"A": "已关闭", "B": "已关闭", "C": "已关闭"}},
}
