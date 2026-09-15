"""yt — YouTrack REST 客户端（原生 Python，账号隔离，next-state 走 statemachine 矩阵）"""
import time
import requests
from . import statemachine
from .config import CONFIG


class YT:
    def __init__(self, acct: str = "agent-pm"):
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
        if lane:  # 泳道是项目级字段（POLY 有，STUDIO 无）
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

    def comments(self, issue: str) -> list[dict]:
        rows = self._get(f"/api/issues/{issue}/comments",
                         params={"fields": "author(login),text,created",
                                 "$top": "50", "reverse": "true"})
        cs = [{"author": (c.get("author") or {}).get("login", "?"),
               "text": c.get("text", ""), "created": c.get("created")} for c in rows]
        cs.sort(key=lambda c: c["created"] or 0)   # 统一时间序（旧→新），消费方按此假设
        return cs


_FIELDS = ("idReadable,summary,description,created,"
           "customFields(name,value(name,text))")
