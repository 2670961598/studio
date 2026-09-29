"""ytguard — YouTrack 平台级状态 guard（宪章§2 欠账；STUDIO-62 提案族试点）

与框架 statemachine 双保险：非法迁移由平台 on-change 规则拒绝（workflow.check
抛错 → 事务回滚），手工/命令/API 三层同拒。迁移表由 kernel/schema/
ticket-types.yaml 同源生成（statemachine.TYPE_EDGES/ROLLBACK），改表走
evolve-schema 后重装，勿手改生成的 JS。

制作人例外道（宪章§4.4「任意介入不弹回」）：opengames 账号的一切迁移放行，
平台 guard 只拦 agent 的手工/命令/API 越表操作。

用法（运维/回滚，PM 持行）:
    cd studio-daemon
    .venv/bin/python -m studio.ytguard status   --pid STUDIO
    .venv/bin/python -m studio.ytguard install  --pid STUDIO --types 提案
    .venv/bin/python -m studio.ytguard uninstall --pid STUDIO
"""
import json
import requests

from . import statemachine
from .config import CONFIG

WF_NAME = "studio-state-guard"          # 平台 workflow 名（STUDIO 全项目挂接）
RULE_NAME = "state-guard"               # issue 级 on-change 规则名（workflow 下唯一规则）
TERMINAL = ["已交付", "已关闭", "已归档", "已取消", "结案"]   # 已取消道的禁区（对齐 statemachine.allowed）


def _adjacency(typ: str) -> dict[str, list[str]]:
    """试点类型邻接表：type_edges ∪ rollback 边（逐步对齐 statemachine.allowed 非交付族路径）。"""
    edges = list(statemachine.TYPE_EDGES.get(typ, [])) + list(statemachine.ROLLBACK)
    adj: dict[str, list[str]] = {}
    for a, b in edges:
        adj.setdefault(a, []).append(b)
    return adj


def render_guard_js(pilot_types: tuple[str, ...] = ("提案",)) -> str:
    """生成 on-change 规则 JS（TABLE 为 JSON 字面量，测试按此回读对表）。

    规则形状为实测定稿（2026-09-29 本实例探针）：原生描述符 target:'Issue' +
    ruleType:'onChange'，不依赖 @jetbrains/youtrack-scripting-api（该库 workflow
    只含全局级模块，无法挂接项目）；拒绝动作=throw → on-change 事务回滚。
    """
    table = {typ: _adjacency(typ) for typ in pilot_types}
    flow_hint = " → ".join(["草稿", "待批", "实施中", "观察窗", "结案"])
    # ES5 写法（YouTrack 脚本引擎保守兼容；官方范本同款 var/function/串接）
    return f"""// 平台级状态 guard（STUDIO-62 提案族试点）——框架生成，勿手改：
// 唯一事实源 kernel/schema/ticket-types.yaml（与 statemachine.py 同源；改表走 evolve-schema 后重装）。
// 非法迁移 throw → on-change 事务回滚（手工/命令/API 三层同拒）；
// 制作人（{CONFIG.producer}）例外放行（宪章§4.4 任意介入不弹回）。
var TERMINAL = {json.dumps(TERMINAL, ensure_ascii=False)};
var CANCEL = '已取消';
var PRODUCER = '{CONFIG.producer}';
var TABLE = {json.dumps(table, ensure_ascii=False)};

exports.rule = {{
  target: 'Issue',
  ruleType: 'onChange',
  title: '平台状态 guard：非法迁移拒绝（STUDIO-62 提案族试点）',
  guard: function (ctx) {{
    var issue = ctx.issue, t = issue.fields.Type;
    return issue.isReported && !!t && Object.keys(TABLE).indexOf(t.name) !== -1
      && issue.fields.isChanged('State') && !!issue.fields.State;
  }},
  action: function (ctx) {{
    var issue = ctx.issue;
    var from = ((issue.fields.oldValue('State') || {{}}).name) || null;
    var to = issue.fields.State.name;
    if (from === to || from === null || issue.updatedBy.login === PRODUCER) return;  // 无变化/新单/制作人例外道
    if (to === CANCEL) {{                       // 取消道：非终态皆可（对齐 statemachine.allowed）
      if (TERMINAL.indexOf(from) !== -1) {{
        throw new Error('平台 guard 拒绝: ' + from + ' → 已取消（终态不可取消）');
      }}
      return;
    }}
    var ok = (TABLE[issue.fields.Type.name][from] || []).indexOf(to) !== -1;
    if (!ok) {{
      throw new Error('平台 guard 拒绝: ' + from + ' → ' + to +
        '（提案族仅允许 {flow_hint}；改表走 evolve-schema）');
    }}
  }}
}};
"""


class GuardAdmin:
    """admin 侧 workflow 装卸（实录端点：POST /api/admin/workflows 造壳（名字仅限
    小写字母数字-_.~）→ POST /rules{name,script} 装 issue 级规则（创建即解析装载，
    规则缺 target/ruleType 直接 400）→ POST projects/{pid}/workflows 挂接。
    注意 /api/admin/workflows 默认分页 $top=42，列全量须显式放大）。"""

    def __init__(self, acct: str = "admin"):
        self.base = CONFIG.yt_url
        self.s = requests.Session()
        self.s.headers["Authorization"] = f"Bearer {CONFIG.token(acct)}"

    def _wf_list(self) -> list[dict]:
        r = self.s.get(f"{self.base}/api/admin/workflows",
                       params={"fields": "id,name", "$top": 500}, timeout=30)
        r.raise_for_status()
        return r.json()

    def _find(self) -> str | None:
        return next((w["id"] for w in self._wf_list() if w["name"] == WF_NAME), None)

    def _usages(self, pid: str) -> list[dict]:
        r = self.s.get(f"{self.base}/api/admin/projects/{CONFIG.proj_id(pid)}/workflows",
                       params={"fields": "id,workflow(id,name)"}, timeout=30)
        r.raise_for_status()
        return r.json()

    def install(self, pid: str, pilot_types: tuple[str, ...] = ("提案",)) -> dict:
        """幂等安装：重装=先卸后装（旧 usage/规则一并清理，表永远与 schema 同源）。"""
        self.uninstall(pid)
        r = self.s.post(f"{self.base}/api/admin/workflows?fields=id,name", timeout=30,
                        json={"name": WF_NAME, "scripts": []})
        r.raise_for_status()
        wf = r.json()["id"]
        r = self.s.post(f"{self.base}/api/admin/workflows/{wf}/rules?fields=id,name",
                        timeout=30, json={"name": RULE_NAME, "script": render_guard_js(pilot_types)})
        r.raise_for_status()
        r = self.s.post(
            f"{self.base}/api/admin/projects/{CONFIG.proj_id(pid)}/workflows"
            f"?fields=id,workflow(id,name)", timeout=30, json={"workflow": {"id": wf}})
        r.raise_for_status()
        return {"workflow": wf, "usage": r.json()["id"], "rule": RULE_NAME,
                "pilot_types": list(pilot_types)}

    def uninstall(self, pid: str, delete_workflow: bool = True) -> dict:
        """回滚：摘 usage →（无他处挂接时）删 workflow；框架 statemachine 不受影响。"""
        wf, out = self._find(), {"detached": [], "deleted": False}
        if wf is None:
            return out
        for u in self._usages(pid):
            if u["workflow"]["id"] != wf:
                continue
            d = self.s.delete(
                f"{self.base}/api/admin/projects/{CONFIG.proj_id(pid)}/workflows/{u['id']}",
                timeout=30)
            d.raise_for_status()
            out["detached"].append(u["id"])
        if delete_workflow and not any(  # 他项目仍挂接则保留实体，只摘本项
                u["workflow"]["id"] == wf
                for p in CONFIG.projects for u in self._usages(p)):
            d = self.s.delete(f"{self.base}/api/admin/workflows/{wf}", timeout=30)
            d.raise_for_status()
            out["deleted"] = True
        return out

    def status(self, pid: str) -> dict:
        wf = self._find()
        ours = [u for u in self._usages(pid) if u["workflow"]["name"] == WF_NAME]
        return {"workflow": wf, "attached": bool(ours),
                "usage": ours[0]["id"] if ours else None}


if __name__ == "__main__":   # 运维 CLI（装卸/回滚；默认试点=提案族）
    import argparse
    ap = argparse.ArgumentParser(description="YouTrack 平台级状态 guard（STUDIO-62 试点）")
    ap.add_argument("cmd", choices=["status", "install", "uninstall"])
    ap.add_argument("--pid", default="STUDIO")
    ap.add_argument("--types", default="提案", help="试点类型，逗号分隔（默认: 提案）")
    a = ap.parse_args()
    g = GuardAdmin()
    if a.cmd == "install":
        print(json.dumps(g.install(a.pid, tuple(a.types.split(","))), ensure_ascii=False))
    elif a.cmd == "uninstall":
        print(json.dumps(g.uninstall(a.pid), ensure_ascii=False))
    else:
        print(json.dumps(g.status(a.pid), ensure_ascii=False))
