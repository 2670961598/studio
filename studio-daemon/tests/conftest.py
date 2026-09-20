"""测试夹具：临时 kernel 目录 + 带状态的假 YouTrack 后端 + 真 git 沙箱仓库。
原则：不碰真实 YouTrack/真实 kernel/真实仓库；所有外部世界在测试进程内。"""
import json, subprocess, sys, time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from studio.config import Config, CONFIG  # noqa: E402

REAL_ROOT = CONFIG._root  # studio-daemon/


@pytest.fixture(autouse=True)
def _no_llm(request, monkeypatch):
    """测试永远不调真实 LLM（C10：批示/DoD/加测岛全部确定性打桩，套件零扣费零外呼）。
    orchestrator 对被桩函数均为函数内延迟 import，打模块属性即可生效。
    test_llm.py 测的是 LLM 岛本体（自带替身），跳过。"""
    if request.node.path.name == "test_llm.py":
        return
    from studio import llm
    monkeypatch.setattr(llm, "ask", lambda *a, **k: None)
    monkeypatch.setattr(llm, "parse_directive", lambda *a, **k: None)
    if hasattr(llm, "reviewed_ask"):
        monkeypatch.setattr(llm, "reviewed_ask", lambda *a, **k: None)


@pytest.fixture
def tmp_config(tmp_path, monkeypatch):
    """把 CONFIG 的全部可写路径指到临时目录（不重建 singleton，只换路径）。"""
    k = tmp_path / "kernel"
    for d in ("locks", "workers", "evidence", "heartbeats", "logs",
              "metrics", "metrics/digest", "schema", "agents", "campaigns", "intel"):
        (k / d).mkdir(parents=True, exist_ok=True)
    # schema 用真实 v2 副本（被测对象）
    real_kernel = REAL_ROOT.parent / "kernel"
    (k / "schema" / "ticket-types.yaml").write_text(
        (real_kernel / "schema" / "ticket-types.yaml").read_text(encoding="utf-8"), encoding="utf-8")
    if (real_kernel / "TEAM.md").exists():
        (k / "TEAM.md").write_text((real_kernel / "TEAM.md").read_text(encoding="utf-8"),
                                   encoding="utf-8")
    monkeypatch.setattr(CONFIG, "_root", tmp_path / "daemon")
    CONFIG._root.mkdir(exist_ok=True)
    monkeypatch.setattr(CONFIG, "locks_dir", k / "locks")
    monkeypatch.setattr(CONFIG, "workers_dir", k / "workers")
    monkeypatch.setattr(CONFIG, "evidence_dir", k / "evidence")
    monkeypatch.setattr(CONFIG, "heartbeats_dir", k / "heartbeats")
    monkeypatch.setattr(CONFIG, "logs_dir", k / "logs")
    monkeypatch.setattr(CONFIG, "events_path", k / "metrics" / "events.jsonl")
    monkeypatch.setattr(CONFIG, "digest_dir", k / "metrics" / "digest")
    yield CONFIG


# ---------------------------------------------------------------- 假 YouTrack
FIELD_TYPE = {"State": "StateIssueCustomField", "Type": "SingleEnumIssueCustomField",
              "轨道": "SingleEnumIssueCustomField", "泳道": "SingleEnumIssueCustomField",
              "Priority": "SingleEnumIssueCustomField",
              "验收命令": "TextIssueCustomField", "来源": "TextIssueCustomField",
              "attempt": "SimpleIssueCustomField", "心跳": "SimpleIssueCustomField"}


class FakeBackend:
    """内存 YouTrack：只实现 yt.py 用到的端点语义。"""

    def _cf_api(self, name, v):
        t = FIELD_TYPE.get(name, "SingleEnumIssueCustomField")
        if isinstance(v, bool):
            return {"name": name, "$type": t, "value": v}
        if isinstance(v, (int, float)):
            return {"name": name, "$type": t, "value": v}
        if t.endswith("TextIssueCustomField"):
            return {"name": name, "$type": t, "value": {"$type": "TextFieldValue", "text": str(v)}}
        return {"name": name, "$type": t, "value": {"name": str(v)}}

    def _issue_api(self, iid):
        it = self.issues[iid]
        return {"idReadable": iid, "summary": it["summary"],
                "description": it.get("description") or "",
                "created": it.get("created", 0),
                "customFields": [self._cf_api(n, v) for n, v in it["fields"].items()]}

    def __init__(self):
        self.issues = {}
        self.counters = {"POLY": 100, "STUDIO": 10}
        self.articles = {}                     # idReadable -> {summary, content, parent, project}
        self.acounters = {"POLY": 0, "STUDIO": 0}
        self._clock = 1000                     # 单调时钟，评论排序用

    def now_ms(self):
        self._clock += 1
        return self._clock

    def create(self, pid, summary, desc, fields):
        self.counters[pid] += 1
        iid = f"{pid}-{self.counters[pid]}"
        self.issues[iid] = {"summary": summary, "description": desc, "created": self.now_ms(),
                            "fields": dict(fields), "comments": []}
        return iid

    def query(self, q):
        import re
        states = re.search(r"状态:([\w,、]+)", q)
        types = re.search(r"Type:(\S+)", q)
        proj = re.search(r"project:(\S+)", q)
        want_s = states.group(1).split(",") if states else None
        want_t = types.group(1) if types else None
        want_p = proj.group(1) if proj else None
        out = []
        for iid, it in self.issues.items():
            if want_p and not iid.lower().startswith(want_p.lower() + "-"):
                continue
            if want_s and it["fields"].get("State") not in want_s:
                continue
            if want_t and it["fields"].get("Type") != want_t:
                continue
            out.append(self._issue_api(iid))
        return sorted(out, key=lambda x: x["idReadable"])

    # ---------- Articles（知识库） ----------
    def article_create(self, pid, summary, content, parent=None):
        self.acounters[pid] = self.acounters.get(pid, 0) + 1
        aid = f"{pid}-A-{self.acounters[pid]}"
        self.articles[aid] = {"summary": summary, "content": content,
                              "parent": parent, "project": pid}
        return aid

    def article_api(self, aid):
        a = self.articles[aid]
        return {"idReadable": aid, "summary": a["summary"], "content": a["content"],
                "parentArticle": {"idReadable": a["parent"]} if a["parent"] else None}


CURRENT_BACKEND = None   # 供测试以任意身份直写评论（opengames 批示模拟）


@pytest.fixture
def fake_yt(tmp_config, requests_mock):
    """挂载假 YouTrack 并返回 backend；yt.YT 走真实 HTTP 客户端代码。"""
    global CURRENT_BACKEND
    from studio.config import CONFIG
    be = FakeBackend()
    CURRENT_BACKEND = be
    U = CONFIG.yt_url

    def _list(request, ctx):
        return be.query(request.qs.get("query", [""])[0])

    def _create(request, ctx):
        body = request.json()
        pid = [p for p, i in CONFIG.projects.items() if i == body["project"]["id"]][0]
        fields = {}
        for cf in body.get("customFields", []):
            v = cf.get("value")
            if isinstance(v, dict):
                v = v.get("name", v.get("text"))
            fields[cf["name"]] = v
        iid = be.create(pid, body["summary"], body.get("description") or "", fields)
        ctx.status_code = 200
        return {"idReadable": iid}

    def _iid(request):
        raw = request.path.split("/api/issues/")[1].split("/")[0]
        for k in be.issues:            # requests_mock 会把 URL 转小写 → 大小写不敏感回查
            if k.lower() == raw.lower():
                return k
        return raw

    def _get(request, ctx):
        iid = _iid(request)
        if iid not in be.issues:
            ctx.status_code = 404
            return {"error": "not found"}
        return be._issue_api(iid)

    def _patch(request, ctx):
        iid = _iid(request)
        for cf in request.json().get("customFields", []):
            v = cf.get("value")
            if isinstance(v, dict):
                v = v.get("name", v.get("text"))
            be.issues[iid]["fields"][cf["name"]] = v
        return {"idReadable": iid}

    def _comments_get(request, ctx):
        iid = _iid(request)
        cs = be.issues[iid]["comments"]
        if str(request.qs.get("reverse", ["false"])[0]).lower() == "true":
            cs = list(reversed(cs))            # 对齐真实 API：reverse=最新在前
        return [{"id": i, "author": {"login": c["author"]}, "text": c["text"], "created": c["created"]}
                for i, c in enumerate(cs)]

    def _comments_post(request, ctx):
        iid = _iid(request)
        be.issues[iid]["comments"].append({"author": "agent-pm", "text": request.json()["text"],
                                           "created": be.now_ms()})
        return {"id": len(be.issues[iid]["comments"])}

    import re as _re
    issue_re = _re.compile(r"/api/issues/[A-Z0-9]+-\d+([?/].*)?$")
    comments_re = _re.compile(r"/api/issues/[A-Z0-9]+-\d+/comments([?/].*)?$")

    def _aid(request):
        raw = request.path.split("/api/articles/")[1].split("/")[0].split("?")[0]
        for k in be.articles:                       # 大小写不敏感回查（对齐 issues 的做法）
            if k.lower() == raw.lower():
                return k
        return raw

    def _articles_list(request, ctx):
        q = request.qs.get("query", [""])[0]
        proj = _re.search(r"project:(\S+)", q)      # qs 已被 requests_mock 转小写
        rows = [be.article_api(a) for a, ar in be.articles.items()
                if not proj or ar["project"].lower() == proj.group(1).lower()]
        return sorted(rows, key=lambda r: r["idReadable"])

    def _articles_create(request, ctx):
        body = request.json()
        pid = [p for p, i in CONFIG.projects.items() if i == body["project"]["id"]][0]
        parent = (body.get("parentArticle") or {}).get("idReadable")
        ctx.status_code = 200
        return {"idReadable": be.article_create(pid, body["summary"],
                                                body.get("content") or "", parent)}

    def _articles_update(request, ctx):
        aid = _aid(request)
        if aid not in be.articles:
            ctx.status_code = 404
            return {"error": "not found"}
        body = request.json()
        if "content" in body:
            be.articles[aid]["content"] = body["content"]
        return {"idReadable": aid}

    article_re = _re.compile(r"/api/articles/[^/?]+([?/].*)?$")
    requests_mock.get(f"{U}/api/users/me", json={"login": "agent-pm", "name": "Agent PM"})
    requests_mock.get(f"{U}/api/issues", json=_list)
    requests_mock.post(f"{U}/api/issues", json=_create)
    requests_mock.get(issue_re, json=_get)          # /api/issues/{id}
    requests_mock.post(issue_re, json=_patch)       # set_field
    requests_mock.get(comments_re, json=_comments_get)
    requests_mock.post(comments_re, json=_comments_post)
    requests_mock.get(f"{U}/api/articles", json=_articles_list)
    requests_mock.post(f"{U}/api/articles", json=_articles_create)
    requests_mock.post(article_re, json=_articles_update)   # /api/articles/{id} 更新正文
    yield be


# ---------------------------------------------------------------- git 沙箱
@pytest.fixture
def git_repo(tmp_path):
    """真 git 仓库：main 上有一个 docs/hello.md；返回路径。"""
    repo = tmp_path / "repo"
    repo.mkdir()
    def g(*a):
        subprocess.run(["git", "-C", str(repo), *a], check=True, capture_output=True, text=True)
    g("init", "-b", "main")
    g("config", "user.email", "t@t")
    g("config", "user.name", "t")
    (repo / "docs").mkdir()
    (repo / "docs" / "hello.md").write_text("# hello\n", encoding="utf-8")
    g("add", "-A")
    g("commit", "-m", "init")
    return repo


@pytest.fixture
def lanes(tmp_config, monkeypatch, git_repo):
    """把 core 泳道指到 git 沙箱。"""
    monkeypatch.setitem(CONFIG.lanes, "core",
                        {"path": str(git_repo), "base_branch": "main",
                         "agent": "agent-core", "yt_acct": "agent-core"})
    yield CONFIG
