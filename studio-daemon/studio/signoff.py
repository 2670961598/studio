"""signoff — 全流程逐环签字协议（STUDIO-79 / 宪章 §12.2「全流程逐环确认」）。
七环：理解→拆分→方案→执行→测试→回归→merge，逐环签字留痕（评论首词 sign-<环名>，
兼容署名前缀 [项目·个体名·部门]，org.yaml 署名协议）。高等级单（等级≥阈值，
org.yaml approvals.全流程签字.阈值，默认 4）在终验收位（合并审）前置校验：
签字不齐 → 合并批示不消费、板面留缺环清单（幂等）。
- 签字资格=批示资格（can_approve：委托代批/亲批泳道同一谓词面，不另造分权）；
  亲批叮嘱（hold）下仅制作人签字有效（语义同 orchestrator._producer_hold）。
- 铁律 §12.3（派单人终验收）：merge 环签字仅派单人本人有效，制作人豁免
  （制作人=终极派单人，宪章 §4.4 任意介入）。
- 幂等：同环重复签字只计一次；低等级单不启用（行为与现状完全一致）。
七环与现有流程的对应：理解/拆分/方案=策划段（L3 方案审）、执行=已派发施工、
测试=证据就绪复验、回归=复验通过、merge=合并审（终验收位）。"""
from . import org

STAGES = ("理解", "拆分", "方案", "执行", "测试", "回归", "merge")
SIGN_PREFIXES = ("sign-", "签-", "签字-")     # 签字词形（中英文），首词精确匹配
DEFAULT_THRESHOLD = 4                         # =L3 特护双轨等级（org.LEVEL_MAP）；G 族更高恒覆盖
HOLD_WORDS = ("亲批", "hold")                 # 语义同 orchestrator.HOLD_WORDS（单据级亲批叮嘱）
REQ_MARK = "全流程签字协议"                    # 立项预告锚点（幂等：每单一次）
FINAL_MARK = "终验前置校验"                    # 缺环评论锚点（幂等：缺环集不变不刷屏）


def threshold(pid: str) -> int:
    """启用阈值（org.yaml approvals.全流程签字.阈值；缺省/坏值回退默认）。"""
    a = (org.project(pid).get("approvals") or {}).get("全流程签字") or {}
    try:
        return int(a.get("阈值") or DEFAULT_THRESHOLD)
    except (TypeError, ValueError):
        return DEFAULT_THRESHOLD


def required(pid: str, level) -> bool:
    """等级判定：level（org_level 双轨解析：等级字段优先/轨道回退）≥阈值才启用。"""
    if level is None:
        return False
    try:
        return int(level) >= threshold(pid)
    except (TypeError, ValueError):
        return False


def strip_signature(text: str) -> str:
    """剥署名前缀（org.yaml 署名协议「[项目·个体名·部门] 正文」）→ 正文首词可解析。"""
    toks = (text or "").strip().split()
    i = 0
    while i < len(toks) and toks[i].startswith("[") and "]" not in toks[i]:
        i += 1                                    # 防御：署名段意外跨 token
    if i < len(toks) and toks[i].startswith("[") and "]" in toks[i]:
        i += 1                                    # 单 token 署名 [STUDIO·宰相(ZCode)·工程部]
    return " ".join(toks[i:])


def parse_sign(text: str) -> str | None:
    """签字评论解析：跳署名后的首词 sign-<环名> → 环名；非签字/未知环 → None。"""
    body = strip_signature(text)
    toks = body.split()
    if not toks:
        return None
    w = toks[0]
    for p in SIGN_PREFIXES:
        if w.startswith(p):
            stage = w[len(p):]
            return stage if stage in STAGES else None
    return None


def is_sign_comment(text: str) -> bool:
    return parse_sign(text) is not None


def signatures(yt, iid, lane=None, dispa=None) -> dict[str, set[str]]:
    """七环 → 有效签字人集合。有效性：制作人恒可（含 hold）；其余=批示资格
    （can_approve），hold 亲批锁定下全灭；merge 环加派单人本人铁律。
    派单人字段缺省 → 终验保守归制作人（同 orchestrator._directives 口径）。"""
    from .config import CONFIG
    from . import approval as _ap
    pid = iid.split("-")[0]
    cs = yt.comments(iid)
    hold = any(c["author"] == CONFIG.producer
               and (c["text"].strip().split() or [""])[0] in HOLD_WORDS for c in cs)
    if dispa is None:
        dispa = yt.f(iid, "派单人") or CONFIG.producer
    dispa_set = {_ap._norm_login(x) for x in _ap._dispa_logins(dispa)}
    out: dict[str, set[str]] = {s: set() for s in STAGES}
    for c in cs:
        stage = parse_sign(c["text"])
        if stage is None:
            continue
        a = c["author"]
        if a != CONFIG.producer:
            if hold or not CONFIG.can_approve(pid, a, lane):
                continue                          # 越权/锁定下代签：留痕可见，计数无效
            if stage == "merge" and _ap._norm_login(a) not in dispa_set:
                continue                          # 铁律 §12.3：merge 环=派单人本人
        out[stage].add(a)
    return out


def coverage(yt, iid, lane=None, dispa=None) -> tuple[set[str], list[str]]:
    """(已签环集合, 缺环有序列表)——缺环保七环顺序，板面提示可读。"""
    sigs = signatures(yt, iid, lane, dispa)
    signed = {s for s, who in sigs.items() if who}
    return signed, [s for s in STAGES if s not in signed]


def final_gate(yt, pid, iid, lane, level=None, dispa=None) -> tuple[bool, list[str], str]:
    """终验收位前置校验：低等级单恒过；高等级单七环签字须齐全。
    返回 (ok, missing, note)——missing 空=放行。"""
    if not required(pid, level):
        return True, [], "免签（等级<阈值）"
    signed, missing = coverage(yt, iid, lane, dispa)
    if not missing:
        return True, [], f"七环签字齐全（{len(signed)}/7）"
    return False, missing, f"缺环[{' '.join(missing)}]（已签 {len(signed)}/7）"


def brief_comment(yt, iid, level, lane=None) -> bool:
    """立项位预告（幂等，锚点评论）：高等级单进待批前发一次七环清单——
    派单人/责任人从第一拍就知道要逐环签字，不等到终验才发现缺环。"""
    pid = iid.split("-")[0]
    if not required(pid, level):
        return False
    if any(c["text"].startswith(REQ_MARK) for c in yt.comments(iid)):
        return False
    yt.comment(iid, f"{REQ_MARK}（等级≥{threshold(pid)}）：本单终验收前须七环签字齐全——"
                    "sign-理解 / sign-拆分 / sign-方案 / sign-执行 / sign-测试 / "
                    "sign-回归 / sign-merge（merge 环=派单人本人）。")
    return True


def snapshot_note(yt, iid, lane=None, level=None, dispa=None) -> str:
    """进终验收位快照（拼进「复验通过，进入合并审」评论）：高等级单附签字状态。
    低等级单返回空串（评论正文不变，行为与现状完全一致）。"""
    pid = iid.split("-")[0]
    if not required(pid, level):
        return ""
    signed, missing = coverage(yt, iid, lane, dispa)
    if not missing:
        return f"{REQ_MARK}：七环签字齐全（{len(signed)}/7）"
    return f"{REQ_MARK}：缺环[{' '.join(missing)}]（已签 {len(signed)}/7），终验前置校验把关"


def pending_comment(yt, iid, missing: list[str]) -> bool:
    """缺环留痕（幂等）：最后一条锚点评论缺环集相同 → 不刷屏；集合变化（新签字
    进来）→ 发进展评论。批示被拒后每 tick 都会重算，此函数保证板面不 flooding。"""
    cur = (f"{FINAL_MARK}：缺环[{' '.join(missing)}]——七环签字未齐，"
           "合并批示暂不消费。签字评论：sign-<环名>（理解/拆分/方案/执行/测试/回归/merge）")
    for c in reversed(yt.comments(iid)):
        if c["text"].startswith(FINAL_MARK):
            if c["text"] != cur:
                yt.comment(iid, cur)
                return True
            return False
    yt.comment(iid, cur)
    return True
