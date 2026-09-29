"""ytguard（STUDIO-62 平台级状态 guard）——表同源性 + 装卸回合 + 与 statemachine 逐步对齐"""
import json
import re

from studio import statemachine
from studio import ytguard


def _table_from_js(js: str) -> dict:
    m = re.search(r"var TABLE = (\{.*?\});\n", js, re.S)
    return json.loads(m.group(1))


def _js_allowed(table: dict, frm: str, to: str) -> bool:
    """JS 侧判定语义的 Python 复刻（测试对表用，勿入生产）。"""
    if to == "已取消":
        return frm not in ytguard.TERMINAL
    return to in table.get(frm, [])


def test_渲染表与schema同源_仅试点类型入表():
    t = _table_from_js(ytguard.render_guard_js(("提案",)))
    want = {}
    for a, b in statemachine.TYPE_EDGES["提案"] + statemachine.ROLLBACK:
        want.setdefault(a, []).append(b)
    assert t == {"提案": want}
    assert "需求" not in t and "缺陷" not in t          # 交付族按轨道展开，试点不含——guard 直接不接管


def test_非法迁移矩阵与statemachine逐步对齐():
    """提案族全态×全态：JS 表判定 == statemachine.allowed（双保险同表铁证）。"""
    t = _table_from_js(ytguard.render_guard_js(("提案",)))["提案"]
    states = sorted(set(t) | {b for v in t.values() for b in v}
                    | set(ytguard.TERMINAL) | {"新单"})
    for frm in states:
        for to in states:
            assert _js_allowed(t, frm, to) == \
                statemachine.allowed(frm, to, None, "提案"), f"{frm} → {to} 分歧"


def test_渲染要点_原生形状与防误伤():
    js = ytguard.render_guard_js(("提案",))
    assert "target: 'Issue'" in js and "ruleType: 'onChange'" in js   # 实测定稿的原生描述符
    assert "issue.updatedBy.login === PRODUCER" in js   # 宪章§4.4：制作人任意介入不弹回
    assert "issue.fields.isChanged('State')" in js      # 非 State 字段改动不触发（防误拒无关编辑）
    assert "var " in js and "=> " not in js             # ES5（脚本引擎保守兼容）
    assert "throw new Error" in js                      # 拒绝动作=抛错回滚（不依赖脚本库）


def test_装卸回合_幂等重装(fake_yt):
    g = ytguard.GuardAdmin()
    assert g.status("STUDIO")["attached"] is False
    r1 = g.install("STUDIO")
    assert r1["pilot_types"] == ["提案"] and r1["rule"] == "state-guard"
    assert g.status("STUDIO") == {"workflow": r1["workflow"], "attached": True,
                                  "usage": r1["usage"]}
    rule = fake_yt.workflows[r1["workflow"]]["rules"][0]
    assert rule["name"] == "state-guard" and "提案" in rule["script"]
    r2 = g.install("STUDIO")                            # 重装=先卸后装，永远单挂接
    assert g.status("STUDIO")["attached"] is True
    assert len(g._usages("STUDIO")) == 1
    assert r2["workflow"] != r1["workflow"]             # 旧实体已清（表与 schema 同源刷新）


def test_卸载即回滚_框架侧不受影响(fake_yt):
    g = ytguard.GuardAdmin()
    g.install("STUDIO")
    out = g.uninstall("STUDIO")
    assert out["deleted"] is True and len(out["detached"]) == 1
    assert g.status("STUDIO")["attached"] is False
    assert statemachine.allowed("草稿", "待批", None, "提案")   # 框架 guard 仍在
