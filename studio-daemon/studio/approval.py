"""approval — org 分权引擎（STUDIO-55 P2，影子模式先行）。
设计：与 legacy（can_approve 三机制）并行计算，影子期只记 SHADOW_DIFF 不干预；
零分歧 3 天后 org.yaml approvals.engine: legacy→shadow→org 切权，legacy 保留可回滚。
维度正交：账号等级（权限锚，org.yaml accounts，新旧 login 兼容）× 派单人（终验收锁）
× 单据等级（批干矩阵）× 部门（联签，P3→STUDIO-78 代码化）× hold（单据级亲批）。"""
from .config import CONFIG
from . import org

# login 改名过渡期双名兼容（agent-N 为准，旧名别名）
LOGIN_ALIASES = {"agent-deputy": "agent-9", "agent-pm": "agent-8", "agent-inspector": "agent-7",
                 "agent-designer": "agent-6", "agent-artist": "agent-5", "agent-qa": "agent-4",
                 "agent-scout": "agent-3", "agent-core": "agent-2", "agent-game": "agent-1"}


def _norm_login(author: str) -> str:
    return LOGIN_ALIASES.get(author, author)


def _accounts_level(author: str) -> int:
    return int((org.load().get("accounts") or {}).get(_norm_login(author)) or 0)


def _dispa_logins(dispa: str) -> set[str]:
    """派单人字段值（可能是个体名如"宰相(ZCode)"或 login）→ 归一为 login 集合。
    org.yaml agents 档案带 login 字段做映射；个体名直存 login 的也兼容。"""
    out = {dispa} if dispa else set()
    for name, a in (org.load().get("projects") or {}).get("STUDIO", {}).get("agents", {}).items():
        if name == dispa:
            lg = (a or {}).get("login")
            if lg:
                out.add(lg)
    return out


# ── 联签协议（STUDIO-78，ORG-DESIGN 部门维度）：跨部门单涉及部门主管全评论签字方放行 ──
COSIGN_WORDS = {"cosign", "联签", "会签"}   # 联签评论词形（首词精确；对齐 orggov 升级会签词汇）


def _sig_ident(text: str, author: str) -> str:
    """评论身份：署名协议 [项目·个体名·部门] 优先，回落 author login（同 orggov 口径——
    生产 org.yaml agents 不带 login 字段，主管个体名只能靠署名识别）。"""
    t = (text or "").strip()
    if t.startswith("[") and "]" in t:
        parts = t[1:t.index("]")].split("·")
        if len(parts) >= 2 and parts[1].strip():
            return parts[1].strip()
    return author


def _body(text: str) -> str:
    """去署名前缀后的正文（首词可解析）。"""
    t = (text or "").strip()
    if t.startswith("[") and "]" in t:
        return t[t.index("]") + 1:].strip()
    return t


def _manager_tokens(pdata: dict, dept: str) -> set[str]:
    """部门主管身份 token 集：个体名 + agents login 别名（双保险，同 _dispa_logins）。"""
    h = ((pdata.get("bu") or {}).get(dept) or {}).get("主管")
    if not h:
        return set()
    out = {h}
    lg = ((pdata.get("agents") or {}).get(h) or {}).get("login")
    return out | {lg} if lg else out


def involved_depts(pdata: dict, depts) -> set[str]:
    """联签涉及部门：显式列举优先；字面值"跨部门"（未列明细）→ 全 bu 部门
    （org 名册是唯一枚举源；联签共担语义=跨到谁谁签，宁全勿漏）。"""
    ds = {d for d in (depts or ()) if d and d != "跨部门"}
    if ds:
        return ds
    if depts and "跨部门" in set(depts):
        return set((pdata.get("bu") or {}).keys())
    return set()


def cosign_missing(pid: str, depts, cs) -> list[str]:
    """联签缺口（STUDIO-78）：跨部门单（部门字段多值，或字面值"跨部门"）须涉及
    部门主管全部留 cosign 评论方放行；返回缺签部门有序清单。非跨部门 → []（无约束）。
    主管缺编/名册缺失的部门不拦（组织数据不全不搞放行死锁，同 org.load 容错哲学）。"""
    raw = {d for d in (depts or ()) if d}
    if len(raw) < 2 and "跨部门" not in raw:
        return []                                          # 单部门/无部门：行为与现状一致
    pdata = org.project(pid)
    need = {d: t for d, t in ((d, _manager_tokens(pdata, d))
                              for d in involved_depts(pdata, raw)) if t}
    signed: set[str] = set()
    for c in cs or ():
        if (_body(c.get("text") or "").split() or [""])[0] not in COSIGN_WORDS:
            continue
        ident = _sig_ident(c.get("text") or "", c.get("author") or "")
        for d, toks in need.items():
            if d not in signed and (ident in toks or c.get("author") in toks):
                signed.add(d)
    return [d for d in sorted(need) if d not in signed]


def org_decide(pid, iid, author, lane, level, dispa, cs, at_final: bool,
               depts=None) -> tuple[bool, str]:
    """org 引擎裁决（含豁免层=语义等价于 legacy 三机制的存量授权）。
    at_final=当前是否终验收位（合并审/方案终批）——铁律：派单人本人。
    depts=单据部门字段集合（orchestrator._dept_set 口径）；跨部门单走联签分支：
    涉及部门主管全部评论签字（cosign/联签/会签）方放行——制作人豁免（终极派单人）。"""
    if author == CONFIG.producer:
        return True, "producer"
    if any((c["text"].strip().split() or [""])[0] in ("亲批", "hold")
           and c["author"] == CONFIG.producer for c in cs):
        return False, "hold-locked"                       # 单据级亲批：代批全灭
    # 联签分支（STUDIO-78）：单据级结构约束（同 hold 位次，先于豁免/矩阵——
    # 签不齐=谁都不能放行，与批示人权限正交）
    miss = cosign_missing(pid, depts, cs)
    if miss:
        return False, f"cosign-pending[{' '.join(miss)}]"
    # 豁免层（org.yaml exemptions 的现行等价实现；切 org 权威时改 yaml 驱动）
    if CONFIG.can_approve(pid, author, lane):
        # 豁免之上叠加 org 增量约束：终验收锁派单人（铁律，制作人 09-29 定死）
        if at_final:
            ok = _norm_login(author) in {_norm_login(d) for d in _dispa_logins(dispa)}
            return ok, "final-owner-only"
        return True, "exempt"
    # 非豁免账号：等级矩阵（批上限=账号等级+1 帽 8；9 恒制作人）
    lv = _accounts_level(author)
    ceiling = min(lv + 1, 8)
    if lv > 0 and level is not None and 1 <= level <= ceiling:
        if at_final:
            ok = _norm_login(author) in {_norm_login(d) for d in _dispa_logins(dispa)}
            return ok, "final-owner-only"
        return True, f"matrix-lv{lv}"
    return False, "no-authority"


def engine_mode(pid: str = "STUDIO") -> str:
    """legacy（现行权威）| shadow（org 并行记账）| org（org 权威）。默认 legacy。"""
    return ((org.project(pid).get("approvals") or {}).get("engine")) or "legacy"
