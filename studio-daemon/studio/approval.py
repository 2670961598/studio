"""approval — org 分权引擎（STUDIO-55 P2，影子模式先行）。
设计：与 legacy（can_approve 三机制）并行计算，影子期只记 SHADOW_DIFF 不干预；
零分歧 3 天后 org.yaml approvals.engine: legacy→shadow→org 切权，legacy 保留可回滚。
维度正交：账号等级（权限锚，org.yaml accounts，新旧 login 兼容）× 派单人（终验收锁）
× 单据等级（批干矩阵）× 部门（联签，P3）× hold（单据级亲批）。"""
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


def org_decide(pid, iid, author, lane, level, dispa, cs, at_final: bool) -> tuple[bool, str]:
    """org 引擎裁决（含豁免层=语义等价于 legacy 三机制的存量授权）。
    at_final=当前是否终验收位（合并审/方案终批）——铁律：派单人本人。"""
    if author == CONFIG.producer:
        return True, "producer"
    if any((c["text"].strip().split() or [""])[0] in ("亲批", "hold")
           and c["author"] == CONFIG.producer for c in cs):
        return False, "hold-locked"                       # 单据级亲批：代批全灭
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
