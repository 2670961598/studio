"""ytguard（STUDIO-62 提案族试点 → STUDIO-76 交付族扩面）——表同源性 + 装卸回合
+ 与 statemachine 逐步对齐（提案族邻接表 / 交付族级别流）+ node 真实执行 JS。"""
import json
import re
import shutil
import subprocess

import pytest

from studio import statemachine
from studio import ytguard

# 全态矩阵回归域：schema states 全集 + 终态 + 入口态
STATES = sorted(set(statemachine._S.get("states", []) or [])
                | {"草稿", "新单"} | set(ytguard.TERMINAL))
# 轨道值样本：四级全名 + 裸前缀 + 旧值 A/B/C + 历史缺省
TRACKS = ["L0 自动", "L1 首批", "L2 常规", "L3 特护", "L3-方案先行", "L2",
          "A 特护", "B 常规", "C 轻轨", "A", "-", "", None]


def _js_tables(js: str) -> dict:
    """回读 JS 里全部 var 表（JSON 字面量单行，勿含 `;\\n`——渲染侧约定）。"""
    out = {}
    for name in ("TABLE", "DELIVERY", "FLOWS", "EXTRA", "ROLLBACK", "LEGACY"):
        m = re.search(rf"var {name} = (.+?);\n", js)
        out[name] = json.loads(m.group(1))
    return out


def _js_level(T: dict, track) -> str:
    """JS levelOf 的 Python 复刻（测试对表用，勿入生产）。"""
    t = (track or "").strip()
    for lv in T["FLOWS"]:
        if t == lv or t.startswith(lv.split()[0]):
            return lv
    return T["LEGACY"].get(t[:1] if t else "", "L2 常规")


def _js_allowed(T: dict, frm: str, to: str, typ: str, track) -> bool:
    """JS action 判定的 Python 复刻（类型边族 + 交付族级别流；测试对表用，勿入生产）。"""
    if to == "已取消":
        return frm not in ytguard.TERMINAL
    if typ in T["DELIVERY"]:
        flow = T["FLOWS"].get(_js_level(T, track))
        if not flow:                       # 流不可解析：fail-closed，仅放 type_edges 入口
            return to in T["EXTRA"].get(typ, {}).get(frm, [])
        if (frm, to) in [(flow[i], flow[i + 1]) for i in range(len(flow) - 1)]:
            return True
        if (frm, to) in [tuple(e) for e in T["ROLLBACK"]] and frm in flow:
            return True
        return to in T["EXTRA"].get(typ, {}).get(frm, [])
    return to in T["TABLE"].get(typ, {}).get(frm, [])


# ---------------------------------------------------------------- 表同源


def test_渲染表与schema同源_默认守护面():
    T = _js_tables(ytguard.render_guard_js())
    want = {}
    for a, b in statemachine.TYPE_EDGES["提案"] + statemachine.ROLLBACK:
        want.setdefault(a, []).append(b)
    assert T["TABLE"] == {"提案": want}                      # 类型边族：试点提案仍在
    assert set(T["DELIVERY"]) == statemachine.DELIVERY_TYPES  # 交付族全量接管（STUDIO-76）
    assert T["DELIVERY"] == sorted(T["DELIVERY"])            # 渲染确定性（schema 重装可比对）
    assert T["FLOWS"] == {k: list(v) for k, v in statemachine.LEVEL_FLOWS.items()}
    assert T["EXTRA"] == {"技术债": {"草稿": ["新单"]}}       # 交付族 type_edges 入口
    assert [tuple(e) for e in T["ROLLBACK"]] == [tuple(e) for e in statemachine.ROLLBACK]


def test_渲染收窄试点_单型可选装():
    """--types 提案（STUDIO-62 试点面）：交付族不接管，TABLE 仍同源。"""
    T = _js_tables(ytguard.render_guard_js(("提案",)))
    assert T["TABLE"]["提案"] and T["DELIVERY"] == []
    assert T["FLOWS"] == {k: list(v) for k, v in statemachine.LEVEL_FLOWS.items()}


# ---------------------------------------------------------------- 与 statemachine 对齐


def test_非法迁移矩阵与statemachine逐步对齐_提案族():
    """提案族全态×全态：JS 表判定 == statemachine.allowed（双保险同表铁证）。"""
    T = _js_tables(ytguard.render_guard_js())
    t = T["TABLE"]["提案"]
    states = sorted(set(t) | {b for v in t.values() for b in v}
                    | set(ytguard.TERMINAL) | {"新单"})
    for frm in states:
        for to in states:
            assert _js_allowed(T, frm, to, "提案", None) == \
                statemachine.allowed(frm, to, None, "提案"), f"提案 {frm} → {to} 分歧"


def test_交付族非法迁移矩阵与statemachine逐步对齐():
    """交付族（需求/缺陷/技术债）全态×全态×全轨道：JS 判定 == statemachine.allowed。
    级别门控铁证：同一迁移 L0 拒/L2 放、L3 必须先批等，全部逐步对齐。"""
    T = _js_tables(ytguard.render_guard_js())
    for typ in sorted(statemachine.DELIVERY_TYPES):
        for trk in TRACKS:
            assert _js_level(T, trk) == statemachine._norm_level(trk), f"{trk} 级别归一分歧"
            for frm in STATES:
                for to in STATES:
                    assert _js_allowed(T, frm, to, typ, trk) == \
                        statemachine.allowed(frm, to, trk, typ), \
                        f"{typ} 轨道:{trk} {frm} → {to} 分歧"


# ---------------------------------------------------------------- 渲染要点


def test_渲染要点_原生形状与防误伤():
    js = ytguard.render_guard_js()
    assert "target: 'Issue'" in js and "ruleType: 'onChange'" in js   # 实测定稿的原生描述符
    assert "issue.updatedBy.login === PRODUCER" in js   # 宪章§4.4：制作人任意介入不弹回
    assert "issue.fields.isChanged('State')" in js      # 非 State 字段改动不触发（防误拒无关编辑）
    assert "issue.fields['轨道']" in js                  # 交付族级别取值（STUDIO-76）
    assert "var " in js and "=> " not in js             # ES5（脚本引擎保守兼容）
    assert "const " not in js and "let " not in js and "`" not in js
    assert "throw new Error" in js                      # 拒绝动作=抛错回滚（不依赖脚本库）


# ---------------------------------------------------------------- node 真实执行

_HARNESS = r"""
const rule = require(process.argv[2]).rule;
function mkctx(o) {
  const fields = {
    Type: o.typ ? {name: o.typ} : null,
    State: {name: o.to},
    isChanged: (n) => n === 'State' && o.stateChanged !== false,
    oldValue: (n) => n === 'State' ? (o.from ? {name: o.from} : null) : null,
  };
  if ('track' in o) fields['轨道'] = o.track === null ? null : {name: o.track};
  return {issue: {isReported: o.reported !== false, fields,
                  updatedBy: {login: o.login || 'agent-2'}}};
}
function run(o) {
  const ctx = mkctx(o);
  if (!rule.guard(ctx)) return 'skip';
  try { rule.action(ctx); return 'pass'; } catch (e) { return 'reject'; }
}
const cases = [
  ['L2 新单→待批',            {typ: '需求', track: 'L2 常规', from: '新单', to: '待批'}, 'pass'],
  ['L2 新单→已派发（跳批）',   {typ: '需求', track: 'L2 常规', from: '新单', to: '已派发'}, 'reject'],
  ['L2 复验通过→待批',        {typ: '需求', track: 'L2 常规', from: '复验通过', to: '待批'}, 'pass'],
  ['L2 复验通过→已交付（跳批）', {typ: '需求', track: 'L2 常规', from: '复验通过', to: '已交付'}, 'reject'],
  ['L2 新单→已交付（跳态）',   {typ: '需求', track: 'L2 常规', from: '新单', to: '已交付'}, 'reject'],
  ['L0 新单→已派发（直通）',   {typ: '需求', track: 'L0 自动', from: '新单', to: '已派发'}, 'pass'],
  ['L0 新单→待批（无审批级拒）', {typ: '需求', track: 'L0 自动', from: '新单', to: '待批'}, 'reject'],
  ['L0 待批→已派发（级别门控）', {typ: '需求', track: 'L0 自动', from: '待批', to: '已派发'}, 'reject'],
  ['L1 待批→已派发（级别门控放行）', {typ: '需求', track: 'L1 首批', from: '待批', to: '已派发'}, 'pass'],
  ['L3 证据就绪→待批（方案审）', {typ: '需求', track: 'L3 特护', from: '证据就绪', to: '待批'}, 'pass'],
  ['L3 新单→已派发（必须先批）', {typ: '需求', track: 'L3 特护', from: '新单', to: '已派发'}, 'reject'],
  ['退回边 证据就绪→已派发',   {typ: '缺陷', track: 'L2 常规', from: '证据就绪', to: '已派发'}, 'pass'],
  ['退回边 已派发→待批',       {typ: '缺陷', track: 'L1 首批', from: '已派发', to: '待批'}, 'pass'],
  ['技术债 草稿→新单（promote）', {typ: '技术债', track: 'L1 首批', from: '草稿', to: '新单'}, 'pass'],
  ['需求 草稿→新单（无入口）',  {typ: '需求', track: 'L2 常规', from: '草稿', to: '新单'}, 'reject'],
  ['轨道缺省→L2 新单→待批',    {typ: '需求', track: null, from: '新单', to: '待批'}, 'pass'],
  ['轨道缺省→L2 新单→已派发',  {typ: '需求', track: null, from: '新单', to: '已派发'}, 'reject'],
  ['旧值 A→L3 新单→已派发',    {typ: '需求', track: 'A 特护', from: '新单', to: '已派发'}, 'reject'],
  ['旧值 C→L0 新单→已派发',    {typ: '需求', track: 'C 轻轨', from: '新单', to: '已派发'}, 'pass'],
  ['非终态取消',              {typ: '需求', track: 'L2 常规', from: '待批', to: '已取消'}, 'pass'],
  ['终态取消',                {typ: '需求', track: 'L2 常规', from: '已交付', to: '已取消'}, 'reject'],
  ['制作人例外道（跳批放行）',  {typ: '需求', track: 'L2 常规', from: '新单', to: '已派发', login: 'opengames'}, 'pass'],
  ['提案 草稿→待批',          {typ: '提案', track: 'G2 类型', from: '草稿', to: '待批'}, 'pass'],
  ['提案 新单→待批（不在边表）', {typ: '提案', track: 'G2 类型', from: '新单', to: '待批'}, 'reject'],
  ['未守护类型不接管',          {typ: '疑问', track: null, from: '新单', to: '待答'}, 'skip'],
  ['State 未变不触发',         {typ: '需求', track: 'L2 常规', from: '待批', to: '待批', stateChanged: false}, 'skip'],
  ['新单（from 空）放行',      {typ: '需求', track: 'L2 常规', from: null, to: '新单'}, 'pass'],
];
for (const [name, o, want] of cases) {
  console.log(JSON.stringify({name, got: run(o), want}));
}
"""


def test_真实JS执行_交付族非法流入被平台拒(tmp_path):
    """node 直跑渲染产物：语法 check + guard/action 全链路（交付族级别门控/退回/
    promote 入口/取消道/制作人例外/防误伤）。无 node 环境跳过（矩阵对齐测试兜底）。"""
    node = shutil.which("node")
    if not node:
        pytest.skip("node 不在 PATH：真实 JS 执行验证不可用（对表测试仍覆盖语义）")
    guard = tmp_path / "guard.js"
    guard.write_text(ytguard.render_guard_js(), encoding="utf-8")
    subprocess.run([node, "--check", str(guard)], check=True)          # 语法装载
    harness = tmp_path / "harness.js"
    harness.write_text(_HARNESS, encoding="utf-8")
    out = subprocess.run([node, str(harness), str(guard)],
                         capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    rows = [json.loads(l) for l in out.stdout.splitlines() if l.strip()]
    assert len(rows) >= 27
    for r in rows:
        assert r["got"] == r["want"], f"JS 实测分歧: {r['name']}"


# ---------------------------------------------------------------- 装卸回合与 CLI


def test_装卸回合_幂等重装(fake_yt):
    g = ytguard.GuardAdmin()
    assert g.status("STUDIO")["attached"] is False
    r1 = g.install("STUDIO")
    assert r1["guard_types"] == list(ytguard._default_types())   # 提案+交付族全量
    assert "需求" in r1["guard_types"] and "缺陷" in r1["guard_types"]
    assert r1["rule"] == "state-guard"
    assert g.status("STUDIO") == {"workflow": r1["workflow"], "attached": True,
                                  "usage": r1["usage"]}
    rule = fake_yt.workflows[r1["workflow"]]["rules"][0]
    assert rule["name"] == "state-guard" and "需求" in rule["script"]
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
    assert statemachine.allowed("新单", "待批", "L2 常规", "需求")


def test_CLI_装卸兼容(fake_yt, capsys):
    """CLI 形状不变（STUDIO-62 起）：status/install/uninstall × --pid/--types；
    默认守护面=提案+交付族，--types 显式收窄（旧试点面仍可选装）。"""
    assert ytguard.main(["status", "--pid", "STUDIO"]) == 0
    assert json.loads(capsys.readouterr().out)["attached"] is False

    assert ytguard.main(["install", "--pid", "STUDIO"]) == 0
    r = json.loads(capsys.readouterr().out)
    assert r["guard_types"] == list(ytguard._default_types())

    assert ytguard.main(["install", "--pid", "STUDIO", "--types", "提案,需求"]) == 0
    assert json.loads(capsys.readouterr().out)["guard_types"] == ["提案", "需求"]

    assert ytguard.main(["uninstall", "--pid", "STUDIO"]) == 0
    assert json.loads(capsys.readouterr().out)["deleted"] is True
    assert ytguard.main(["status", "--pid", "STUDIO"]) == 0
    assert json.loads(capsys.readouterr().out)["attached"] is False
