"""yt — YouTrack REST 客户端（原生 Python，账号隔离，next-state 走 statemachine 矩阵）"""
import time
import requests
from . import statemachine
from .config import CONFIG


class DeriveRefused(ValueError):
    """派生拒建（等级违规等治理约束）：父单已评论留痕，细节见异常消息。"""


def _levelless(typ) -> bool:
    """「级别:无」族判定（运营/知识/事件——schema 唯一事实源）：不参与等级梯。
    未知类型 fail-closed（按有级别过梯）——不认识的一律受校验，防绕道。"""
    fam = statemachine.family_of(typ or "")
    return bool(fam) and fam.get("级别") in (None, "无")


class YT:
    def __init__(self, acct: str = "agent-8"):
        self.acct = acct
        self.base = CONFIG.yt_url
        self.s = requests.Session()
        self.s.headers["Authorization"] = f"Bearer {CONFIG.token(acct)}"

    # ---- 基础 ----
    def _get(self, path, **kw):
        r = self.s.get(f"{self.base}{path}", timeout=30, **kw)
        r.raise_for_status()
        return r.json()

    def _post(self, path, body, **kw):
        r = self.s.post(f"{self.base}{path}", json=body, timeout=30, **kw)
        r.raise_for_status()
        return r.json()

    def whoami(self):
        return self._get("/api/users/me?fields=login,name")

    # ---- 单据 ----
    def list(self, pid: str, query: str) -> list[dict]:
        """返回 [{id, state, track, lane, type, summary}]"""
        q = f"project:{pid} {query}"
        rows = self._get("/api/issues", params={
            "query": q, "fields": "idReadable,summary,customFields(name,value(name,text))"})
        out = []
        for it in rows:
            f = {c["name"]: c.get("value") for c in it.get("customFields", [])}
            val = lambda n: (f.get(n) or {})
            out.append({
                "id": it["idReadable"], "summary": it.get("summary", ""),
                "state": val("State").get("name", "-"),
                "track": val("轨道").get("name", "-"),
                "lane": val("泳道").get("name", "-"),
                "type": val("Type").get("name", "-"),
            })
        return out

    def get(self, issue: str) -> dict:
        it = self._get(f"/api/issues/{issue}", params={"fields": _FIELDS})
        d = {"id": it["idReadable"], "summary": it.get("summary", ""),
             "description": it.get("description") or "", "created": it.get("created"),
             "fields": {}}
        for c in it.get("customFields", []):
            v = c.get("value")
            if isinstance(v, dict):
                d["fields"][c["name"]] = v.get("name") if v.get("name") is not None else v.get("text")
            else:
                d["fields"][c["name"]] = v
        return d

    def f(self, issue: str, name: str):
        return self.get(issue)["fields"].get(name)

    def new(self, pid: str, summary: str, desc: str, lane: str | None = "core", prio="normal",
            typ="需求", track="L2 常规", state="新单") -> str:
        cfs = [
            {"name": "State", "$type": "StateIssueCustomField", "value": {"name": state}},
            {"name": "Priority", "$type": "SingleEnumIssueCustomField", "value": {"name": prio}},
            {"name": "Type", "$type": "SingleEnumIssueCustomField", "value": {"name": typ}},
            {"name": "轨道", "$type": "SingleEnumIssueCustomField", "value": {"name": track}},
            {"name": "attempt", "$type": "SimpleIssueCustomField", "value": 0},
        ]
        # 泳道是项目级字段（POLY 有，STUDIO 无）；"-" 是板面"无泳道"哨兵而非枚举值
        # （STUDIO-37 实录：list() 无泳道折成 "-"，照传建单必 400）——哨兵=无泳道，不带字段
        if lane and lane != "-":
            cfs.append({"name": "泳道", "$type": "SingleEnumIssueCustomField", "value": {"name": lane}})
        body = {"project": {"id": CONFIG.proj_id(pid)}, "summary": summary,
                "description": desc, "customFields": cfs}
        return self._post("/api/issues?fields=idReadable", body)["idReadable"]

    # ---- 字段与状态 ----
    def set_field(self, issue: str, name: str, value, ftype="SingleEnumIssueCustomField"):
        if isinstance(value, dict):
            v = value
        elif ftype.startswith("Simple"):
            v = value  # attempt/心跳等数值字段：裸值
        else:
            v = {"name": value}
        body = {"customFields": [{"name": name, "$type": ftype, "value": v}]}
        self._post(f"/api/issues/{issue}?fields=idReadable", body)

    def set_text(self, issue: str, name: str, text: str):
        self.set_field(issue, name, {"$type": "TextFieldValue", "text": text},
                       ftype="TextIssueCustomField")

    def transition(self, issue: str, to: str):
        """矩阵校验的状态迁移；返回 (from, to)；非法抛 ValueError。"""
        frm = self.f(issue, "State") or "-"
        trk = self.f(issue, "轨道")
        typ = self.f(issue, "Type")
        if not statemachine.allowed(frm, to, trk, typ):
            raise ValueError(f"非法迁移 {frm} → {to} (轨道:{trk} 类型:{typ}) {issue}")
        self.set_field(issue, "State", to, "StateIssueCustomField")
        return frm, to

    def attempt_inc(self, issue: str) -> int:
        cur = int(self.f(issue, "attempt") or 0)
        self.set_field(issue, "attempt", cur + 1, "SimpleIssueCustomField")
        return cur + 1

    def gate_freeze(self, issue: str, cmd: str, expect_hash: str = ""):
        self.set_text(issue, "验收命令", cmd)
        if expect_hash:
            self.set_text(issue, "期望输出哈希", expect_hash)

    def heartbeat(self, issue: str):
        self.set_field(issue, "心跳", int(time.time() * 1000), "SimpleIssueCustomField")

    def comment(self, issue: str, text: str):
        self._post(f"/api/issues/{issue}/comments?fields=id", {"text": text})

    # ---- 派生链（STUDIO-60：原生 issue links 主轨，「父单」文本字段降级兼容） ----
    def links(self, issue: str) -> list[dict]:
        """原生 issue links → [{type, direction, ids}]（Subtask/Relates 等）。"""
        rows = self._get(f"/api/issues/{issue}/links",
                         params={"fields": "direction,linkType(name),issues(idReadable)"})
        return [{"type": (r.get("linkType") or {}).get("name", "?"),
                 "direction": r.get("direction", "?"),
                 "ids": [i.get("idReadable") for i in r.get("issues", [])]}
                for r in rows]

    def parents(self, issue: str) -> list[str]:
        """Subtask 反向父单（links 主轨；子单的 INWARD 组）。"""
        return [i for g in self.links(issue)
                if g["type"] == "Subtask" and g["direction"] == "INWARD" for i in g["ids"]]

    def subtasks(self, issue: str) -> list[str]:
        """Subtask 正向子单（父单的 OUTWARD 组）。"""
        return [i for g in self.links(issue)
                if g["type"] == "Subtask" and g["direction"] == "OUTWARD" for i in g["ids"]]

    def parent_of(self, issue: str) -> str | None:
        """父单解析：原生 links 优先；无 links 降级读「父单」文本字段（老单兼容）。"""
        ps = self.parents(issue)
        return ps[0] if ps else (self.f(issue, "父单") or None)

    def link_subtask(self, parent: str, child: str):
        """child 挂为 parent 的 Subtask（子侧 INWARD 建链；幂等：已挂跳过）。"""
        if parent in self.parents(child):
            return
        self._post(f"/api/issues/{child}/links?fields=id", {
            "linkType": {"name": "Subtask"}, "direction": "INWARD",
            "issues": [{"idReadable": parent}]})

    def derive(self, parent: str, summary: str, desc: str, *, lane="core", prio="normal",
               typ="需求", track="L2 常规", state="新单") -> str:
        """从 parent 派生子单（拆解/孵化的统一治理入口）：
        ① org_level 双轨校验 子等级<父（YouTrack 等级字段优先，回退轨道映射）；
        ② 违规拒建：不留半成品，parent 评论留痕 + 抛 DeriveRefused；
           「级别:无」族父单（战役=孵化器）豁免等级梯，链路照建；
        ③ 建单后挂 Subtask link（主轨）+ 回写「父单」文本字段（降级兼容老读方）。"""
        if not _levelless(self.f(parent, "Type")):
            from .org import level_of
            plv = level_of(self.f(parent, "轨道") or "", self.f(parent, "等级"))
            clv = level_of(track or "", None)
            if plv is None or clv is None or clv >= plv:
                self.comment(parent, f"拒建派生子单「{summary[:40]}」：等级违规"
                             f"（子 {clv} ≮ 父 {plv}，org_level 双轨解析）")
                raise DeriveRefused(f"{parent} 拒建子单「{summary[:30]}」：子等级 {clv} ≮ 父等级 {plv}")
        kid = self.new(parent.split("-")[0], summary, desc, lane=lane, prio=prio,
                       typ=typ, track=track, state=state)
        self.link_subtask(parent, kid)
        self.set_text(kid, "父单", parent)
        return kid

    # ---- 知识库（Articles，STUDIO-13 迁移后的档案唯一事实源） ----
    def wiki_all(self, pid: str = "STUDIO") -> dict[str, dict]:
        """全量 Articles → {「父/子」路径: {id, summary, content}}。"""
        rows = self._get("/api/articles", params={
            "query": f"project:{pid}",
            "fields": "idReadable,summary,content,parentArticle(idReadable)"})
        by_id = {r["idReadable"]: r for r in rows}
        out = {}
        for r in rows:
            parts, cur = [r["summary"]], r
            while (cur.get("parentArticle") or {}).get("idReadable"):
                cur = by_id.get(cur["parentArticle"]["idReadable"])
                if cur is None or len(parts) > 8:      # 防御环状父链
                    break
                parts.append(cur["summary"])
            out["/".join(reversed(parts))] = {
                "id": r["idReadable"], "summary": r["summary"], "content": r.get("content") or ""}
        return out

    def wiki_get(self, path: str, pid: str = "STUDIO") -> str:
        """按路径取正文（如 编制/worker）；不存在抛 KeyError。"""
        arts = self.wiki_all(pid)
        if path not in arts:
            raise KeyError(f"Article 不存在: {path}（现有: {sorted(arts)}）")
        return arts[path]["content"]

    def wiki_create(self, path: str, content: str, pid: str = "STUDIO") -> str:
        """按路径写入 article：父节点逐级补建；已存在则原地更新正文（幂等，可重跑）。"""
        arts = self.wiki_all(pid)
        segs = path.split("/")
        parent = ""
        for seg in segs[:-1]:                          # 补齐父链（编制/手册/全局/框架/项目）
            p = f"{parent}/{seg}" if parent else seg
            if p not in arts:
                arts[p] = {"id": self._post("/api/articles?fields=idReadable", {
                    "project": {"id": CONFIG.proj_id(pid)}, "summary": seg, "content": "",
                    "visibility": {"$type": "UnlimitedVisibility"}})["idReadable"]}
            parent = p
        if path in arts:                               # 幂等：重跑 = 更新
            self._post(f"/api/articles/{arts[path]['id']}?fields=idReadable",
                       {"content": content})
            return arts[path]["id"]
        body = {"project": {"id": CONFIG.proj_id(pid)}, "summary": segs[-1],
                "content": content, "visibility": {"$type": "UnlimitedVisibility"}}
        if parent:
            body["parentArticle"] = {"idReadable": arts[parent]["id"]}
        return self._post("/api/articles?fields=idReadable", body)["idReadable"]

    def comments(self, issue: str) -> list[dict]:
        rows = self._get(f"/api/issues/{issue}/comments",
                         params={"fields": "author(login),text,created"})
        cs = [{"author": (c.get("author") or {}).get("login", "?"),
               "text": c.get("text", ""), "created": c.get("created")} for c in rows]
        cs.sort(key=lambda c: c["created"] or 0)   # 统一时间序（旧→新），消费方按此假设
        return cs


_FIELDS = ("idReadable,summary,description,created,"
           "customFields(name,value(name,text))")
