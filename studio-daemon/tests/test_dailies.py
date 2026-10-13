"""dailies 项目日巡三岗（STUDIO-109：ZCode 四定时岗归框架收官）。
宰相验收口径：三岗注册（含治理开关）/首跑产物路径（本地+Articles 运营日报区）/
异常评论@制作人路径（日指纹幂等）三例；零批示零状态迁移（只评论/发文，不碰板面状态）。"""
import json, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import studio.dailies as D                                    # noqa: E402
from studio.config import CONFIG                              # noqa: E402
from studio.yt import YT                                      # noqa: E402

TODAY = time.strftime("%F")


def _seed_events(*rows):
    """events.jsonl 追加事件（近 24h 内的时间戳）。"""
    with open(CONFIG.events_path, "a", encoding="utf-8") as f:
        for pid, iid, ev, attempt in rows:
            f.write(json.dumps({"ts": time.strftime("%F %T"), "pid": pid, "issue": iid,
                                "event": ev, "actor": "t", "attempt": attempt, "note": ""},
                               ensure_ascii=False) + "\n")


def _seed_runs(job, outcome):
    p = CONFIG.events_path.parent / "runs.jsonl"
    with open(p, "a", encoding="utf-8") as f:
        f.write(json.dumps({"ts": time.strftime("%F %T"), "job": job, "name": "?",
                            "outcome": outcome, "duration_ms": 0, "summary": ""},
                           ensure_ascii=False) + "\n")


class Test岗位注册:
    def test_三岗注册且cron正确(self, tmp_config):
        """STUDIO-109 验收例①：三岗进调度；pm-daily 钦点 08:30，games/poly 错峰 09:10/09:20。"""
        import studio.daemon as d
        from studio import runtime
        prev = runtime.SCHED
        try:
            s = d._sched()
            jobs = {j.id: str(j.trigger) for j in s.get_jobs()}
            assert {"games-daily", "poly-daily", "pm-daily"} <= set(jobs)
            assert "hour='8', minute='30'" in jobs["pm-daily"]
            assert "hour='9', minute='10'" in jobs["games-daily"]
            assert "hour='9', minute='20'" in jobs["poly-daily"]
        finally:
            runtime.SCHED = prev

    def test_治理开关关闭时不注册(self, tmp_config, monkeypatch):
        """实验场防双写生产板：STUDIO_GOVERNANCE=0 三岗不装（同 self-eval/patrol 族）。"""
        import studio.daemon as d
        from studio import runtime
        monkeypatch.setenv("STUDIO_GOVERNANCE", "0")
        prev = runtime.SCHED
        try:
            s = d._sched()
            ids = {j.id for j in s.get_jobs()}
            assert not ({"games-daily", "poly-daily", "pm-daily"} & ids)
        finally:
            runtime.SCHED = prev


class Test首跑产物路径:
    def test_三岗首跑产物落本地与Articles运营日报区(self, fake_yt, tmp_config):
        """STUDIO-109 验收例②：首跑 → 本地 reports/*.md + Articles 运营日报/<kind>-<日>。"""
        _seed_events(("GAMES", "G-1", "GATE_PASS", 0), ("GAMES", "G-1", "GATE_FAIL", 0),
                     ("POLY", "P-1", "DISPATCH", 0))
        _seed_runs("pm-games", "ok")
        be = fake_yt
        yt = YT("agent-8")
        be.counters["GAMES"] = 50                       # FakeBackend 默认只带 POLY/STUDIO 计数
        g = yt.new("GAMES", "战役：塔防迭代", "d", typ="战役", state="运行中")
        (Path(CONFIG._root.parent / "kernel" / "campaigns") / f"{g}.state.json").write_text(
            json.dumps({"last": time.time() - 7200, "count": 3}), encoding="utf-8")
        for job in (D.games_daily, D.poly_daily, D.pm_daily):
            out = job()
            assert out["result"] == "OK"
        rp = CONFIG.events_path.parent / "reports"
        for kind in ("games", "poly", "pm"):
            assert (rp / f"{kind}-{TODAY}.md").exists()          # 本地留底
            sums = {a["summary"] for a in be.articles.values()}
            assert f"{kind}-{TODAY}" in sums and "运营日报" in sums   # Articles 运营日报区
        gmd = (rp / f"games-{TODAY}.md").read_text(encoding="utf-8")
        assert "质量档案" in gmd and g in gmd and "已巡逻 3 轮" in gmd   # 质量段+战役核对段
        pmmd = (rp / f"pm-{TODAY}.md").read_text(encoding="utf-8")
        for sec in ("daemon 健康", "影子分歧", "断路单", "队列积压"):
            assert sec in pmmd                                   # 巡检四件事齐

    def test_org_yaml三岗登记(self):
        """org.yaml agents 段三岗档案在册（岗位身份/定时/上级=宰相，STUDIO-109 注册要求）。
        直读仓内真实文件（org.ORG_PATH 是 import 期常量，随 tmp_config 漂移，不可用）。"""
        import yaml
        p = Path(__file__).resolve().parent.parent.parent / "kernel" / "org.yaml"
        data = yaml.safe_load(p.read_text(encoding="utf-8"))
        ag = (data.get("projects", {}).get("STUDIO", {}) or {}).get("agents") or {}
        for name, cron in (("GAMES专岗", "games-daily"), ("三消专岗", "poly-daily"),
                           ("巡检引擎", "pm-daily")):
            assert name in ag and cron in (ag[name].get("定时") or "")
            assert ag[name].get("上级") == "宰相(ZCode)"


class Test异常评论路径:
    def test_断路与影子分歧_评论制作人且日幂等(self, fake_yt, tmp_config):
        """STUDIO-109 验收例③：断路/影子分歧单收到署名@制作人评论；同日重跑不刷屏。"""
        be = fake_yt
        yt = YT("agent-8")
        be.counters["GAMES"] = 50
        br = yt.new("GAMES", "断路测单", "d", state="已派发")
        sh = yt.new("STUDIO", "影子测单", "d", state="待批")
        # 种子事件单号对齐到真实单据（近 24h 内）
        CONFIG.events_path.write_text(
            json.dumps({"ts": time.strftime("%F %T"), "pid": "GAMES", "issue": br,
                        "event": "GATE_FAIL", "actor": "t", "attempt": 3, "note": ""},
                       ensure_ascii=False) + "\n" +
            json.dumps({"ts": time.strftime("%F %T"), "pid": "STUDIO", "issue": sh,
                        "event": "SHADOW_DIFF", "actor": "t", "attempt": 0,
                        "note": "org 批 / legacy 不批"}, ensure_ascii=False) + "\n",
            encoding="utf-8")
        out = D.pm_daily()
        acts = " ".join(out["actions"])
        assert f"ALARM {br}" in acts and f"ALARM {sh}" in acts
        for iid in (br, sh):                              # pm 岗告警统一署名巡检引擎
            cs = [c["text"] for c in be.issues[iid]["comments"]]
            assert any(f"@{CONFIG.producer}" in t and "巡检引擎" in t and "日巡告警" in t
                       for t in cs)
        D.pm_daily()                                             # 同日重跑：日指纹幂等不刷屏
        assert len([c for c in be.issues[br]["comments"] if "日巡告警" in c["text"]]) == 1

    def test_games断路评论与poly积压告警(self, fake_yt, tmp_config):
        """games 岗断路逐单@制作人；poly 岗 core 积压超阈评论最老积压单（亲批泳道中性呈报）。"""
        yt = YT("agent-8")
        be = fake_yt
        be.counters["GAMES"] = 50
        br = yt.new("GAMES", "g断路", "d", state="已派发")
        CONFIG.events_path.write_text(
            json.dumps({"ts": time.strftime("%F %T"), "pid": "GAMES", "issue": br,
                        "event": "GATE_FAIL", "actor": "t", "attempt": 3, "note": ""},
                       ensure_ascii=False) + "\n", encoding="utf-8")
        D.games_daily()
        assert any("日巡告警" in c["text"] and "GAMES专岗" in c["text"]
                   for c in be.issues[br]["comments"])
        for i in range(D.CORE_BACKLOG_ALARM):                    # core 新单积压到阈值
            yt.new("POLY", f"core积压{i}", "d", lane="core", state="新单")
        out = D.poly_daily()
        oldest = [r for r in be.issues
                  if r.startswith("POLY") and be.issues[r]["fields"].get("泳道") == "core"][0]
        assert f"ALARM {oldest}" in " ".join(out["actions"])
        assert any("亲批" in c["text"] for c in be.issues[oldest]["comments"])

    def test_零批示零状态迁移(self, fake_yt, tmp_config, monkeypatch):
        """红线：三岗全程不碰 transition/set_field/new——批单权不进岗位（STUDIO-109 需求②）。"""
        yt = YT("agent-8")
        banned = []
        for name in ("transition", "set_field", "new", "gate_freeze", "set_text"):
            orig = getattr(yt, name)
            def _trap(*a, _n=name, _o=orig, **k):
                banned.append(_n)
                return _o(*a, **k)
            monkeypatch.setattr(yt, name, _trap, raising=False)
        monkeypatch.setattr(D, "_yt", lambda: yt)
        _seed_events(("GAMES", "G-1", "GATE_PASS", 0))
        D.games_daily()
        D.poly_daily()
        D.pm_daily()
        assert banned == []                                      # 只读+评论+发文，零状态动作
