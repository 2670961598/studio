"""orggov：org.yaml team_level 升级链（STUDIO-55/80，宪章 §12.6 负责人提议→领导层会签→制作人终验）。
三例冻结验收：①全链走通并应用 ②会签门槛+终验时序 ③越权/非法/重提作废；附 scan 端到端。"""
import sys
from pathlib import Path
import yaml
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from studio import orggov                      # noqa: E402

PROD = "opengames"
ORG_FIXTURE = """\
# 组织架构唯一事实源（测试副本：结构对齐生产 kernel/org.yaml）
version: 1
projects:
  STUDIO:                        # 2 级团队（注释必须保住：改写不许 round-trip）
    team_level: 2
    leader: {name: 宰相(ZCode), level: 2, 上级: opengames}
    bu:
      工程部: {主管: 宰相(ZCode), 上级: [宰相(ZCode)], 职能: 开发/修bug/重构, 泳道: [explore]}
      质量部: {主管: 自评引擎, 上级: [宰相(ZCode)], 职能: 测试/复盘}
      情报部: {主管: 巡逻引擎, 上级: [宰相(ZCode)], 职能: 前沿扫描}
    agents:
      宰相(ZCode): {level: 2, 部门: [工程部], 角色: 宰相, 上级: opengames, login: agent-9}
      自评引擎: {level: 1, 部门: [质量部], 角色: 质量部主管, 上级: 宰相(ZCode), login: agent-4}
      巡逻引擎: {level: 1, 部门: [情报部], 角色: 情报部主管, 上级: 宰相(ZCode), login: agent-3}
      worker池: {level: 1, 部门: [工程部], 角色: 施工执行, 上级: 宰相(ZCode), login: agent-1}
    approvals:
      engine: shadow
      派单人终验收: true
accounts:
  agent-9: 9
  agent-4: 4
  agent-3: 3
  agent-1: 1
"""


def _org_env(tmp_config):
    """临时 kernel/org.yaml（hermetic：不读生产组织文件）。"""
    p = tmp_config._root.parent / "kernel" / "org.yaml"
    p.write_text(ORG_FIXTURE, encoding="utf-8")
    return p


def _pdata(tmp_config):
    return yaml.safe_load((tmp_config._root.parent / "kernel" / "org.yaml")
                          .read_text(encoding="utf-8"))["projects"]["STUDIO"]


def C(author, created, text):
    return {"author": author, "created": created, "text": text}


PROP3 = "[STUDIO·宰相(ZCode)·工程部] org-upgrade 3 编制扩容：增设设计部"
COS_QA = "[STUDIO·自评引擎·质量部] cosign 质量侧就绪"
COS_INTel = "[STUDIO·巡逻引擎·情报部] 会签"


# ── 例① 全链走通：提议→会签→终验→应用（保注释改写+写后断言+幂等） ──────────────
def test_例1_全链走通并应用(tmp_config):
    p = _org_env(tmp_config)
    cs = [C("agent-9", 100, PROP3),
          C("agent-4", 101, COS_QA),
          C("agent-3", 102, COS_INTel),
          C(PROD, 103, "approve")]
    ch = orggov.evaluate(_pdata(tmp_config), cs, PROD)
    assert (ch.stage, ch.target, ch.cosigned, ch.need) == ("ready", 3, 3, 3)
    assert orggov.apply_level("STUDIO", 3) == 2
    text = p.read_text(encoding="utf-8")
    assert "team_level: 3" in text
    assert "# 2 级团队（注释必须保住：改写不许 round-trip）" in text   # 注释未被抹
    assert yaml.safe_load(text)["projects"]["STUDIO"]["team_level"] == 3
    assert orggov.leadership(_pdata(tmp_config)) == ["宰相(ZCode)", "自评引擎", "巡逻引擎"]
    # 幂等：应用标记在位 → 再评估为 applied（而非 invalid「=现状」）
    cs.append(C("agent-8", 104, "ORG-UPGRADE-APPLIED STUDIO 2→3：升级完成"))
    assert orggov.evaluate(_pdata(tmp_config), cs, PROD).stage == "applied"


# ── 例② 门槛与时序：会签不齐不放行；制作人抢跑 approve 不算终验 ─────────────────
def test_例2_会签门槛与终验时序(tmp_config):
    _org_env(tmp_config)
    pd = _pdata(tmp_config)
    cs = [C("agent-9", 100, PROP3),
          C("agent-4", 101, COS_QA),
          C(PROD, 103, "approve")]                       # 制作人在会签齐之前批
    ch = orggov.evaluate(pd, cs, PROD)
    assert ch.stage == "pending-cosign"                  # 2/3（提议人计入），终验暂不认
    assert ch.cosigned == 2 and "巡逻引擎" in ch.detail
    cs.append(C("agent-3", 104, COS_INTel))              # 会签在 approve 之后才齐
    ch = orggov.evaluate(pd, cs, PROD)
    assert ch.stage == "pending-producer"                # 抢跑的 approve 不算终验
    cs.append(C(PROD, 105, "approve"))                   # 会签齐之后补终验
    assert orggov.evaluate(pd, cs, PROD).stage == "ready"


# ── 例③ 越权与非法与重提作废：非负责人不构成提议；非法等级拒；重提清零旧链 ────────
def test_例3_越权非法与重提作废(tmp_config):
    _org_env(tmp_config)
    pd = _pdata(tmp_config)
    # 非负责人（worker池）提议：即便有会签+制作人 approve 也不构成提议
    cs = [C("agent-1", 100, "[STUDIO·worker池·工程部] org-upgrade 3 我想升"),
          C("agent-4", 101, COS_QA),
          C(PROD, 102, "approve")]
    assert orggov.evaluate(pd, cs, PROD).stage == "idle"
    # 非法等级：越界 / 等于现状
    assert orggov.evaluate(pd, [C("agent-9", 100, "[STUDIO·宰相(ZCode)·工程部] org-upgrade 10 扩到十级")], PROD).stage == "invalid"
    assert orggov.evaluate(pd, [C("agent-9", 100, "[STUDIO·宰相(ZCode)·工程部] org-upgrade 2 维持现状")], PROD).stage == "invalid"
    # 负责人重提：旧链上的会签/终验全部作废，重新数签
    cs = [C("agent-9", 100, PROP3),
          C("agent-4", 101, COS_QA),
          C("agent-3", 102, COS_INTel),
          C(PROD, 103, "approve"),
          C("agent-9", 200, "[STUDIO·宰相(ZCode)·工程部] org-upgrade 4 再扩一档")]
    ch = orggov.evaluate(pd, cs, PROD)
    assert (ch.stage, ch.target, ch.cosigned) == ("pending-cosign", 4, 1)   # 只剩提议人自己


# ── 端到端：scan 从假 YouTrack 收割提案单并应用（含单据推进与二次扫描幂等） ──────
def test_scan_端到端应用与幂等(fake_yt, tmp_config):
    _org_env(tmp_config)
    from studio.config import CONFIG
    from studio.yt import YT
    yt = YT("agent-8")
    iid = yt.new("STUDIO", "STUDIO 升 3 级", "扩编制", lane=None,
                 typ="提案", track="G3 编制", state="草稿")
    be = fake_yt
    for author, text in [("agent-9", PROP3), ("agent-4", COS_QA),
                         ("agent-3", COS_INTel), (PROD, "approve")]:
        be.issues[iid]["comments"].append({"author": author, "created": be.now_ms(), "text": text})
    out = orggov.scan()
    assert any(a.startswith("APPLIED") and "2→3" in a for a in out)
    text = (CONFIG._root.parent / "kernel" / "org.yaml").read_text(encoding="utf-8")
    assert "team_level: 3" in text and "# 2 级团队" in text
    assert yt.f(iid, "State") == "观察窗"               # 提案族推进：草稿→待批→实施中→观察窗
    assert any(c["text"].startswith("ORG-UPGRADE-APPLIED") for c in yt.comments(iid))
    ev = (CONFIG.events_path.read_text(encoding="utf-8")).strip().splitlines()
    assert any("ORG_UPGRADE" in ln for ln in ev)        # 事件记账留痕
    assert orggov.scan() == []                          # 二次扫描无动作（已应用+状态出集）
