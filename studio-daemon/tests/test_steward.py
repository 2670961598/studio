"""steward 框架管家岗哨（STUDIO-83）：收割校验 + @宰相终验提醒 + 退回要点 + 幂等。
宰相派单验收口径：岗哨注册（test_smoke）/收割校验逻辑/@宰相评论格式/三例测试/全量绿。"""
import hashlib, json, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from studio import steward                                    # noqa: E402
from studio.config import CONFIG                              # noqa: E402
from studio.yt import YT                                      # noqa: E402

GATE = "python -m pytest tests/ -q"


def _mk(yt, state="证据就绪", lane="framework", track="L2 常规", typ="需求"):
    iid = yt.new("STUDIO", "管家测单", "d", lane=lane, typ=typ, track=track, state=state)
    yt.gate_freeze(iid, GATE)
    return iid


def _write_ev(iid, tag, *, exit=0, cmd=GATE, tamper=False):
    """造一份 run_gate 兼容证据（JSON+log 同名成对）；tamper=落盘后改日志（哈希失配）。"""
    d = CONFIG.evidence_dir / "STUDIO"
    d.mkdir(parents=True, exist_ok=True)
    log = d / f"{iid}-{tag}.log"
    log.write_text(f"48 passed in 0.5s\niid={iid} tag={tag}\n", encoding="utf-8")
    ev = {"issue": iid, "project": "STUDIO", "attempt": tag, "lane": "framework",
          "branch": f"feature/{iid}", "commit": "abc1234", "cmd": cmd, "exit": exit,
          "ts": "2026-09-30T00:00:00Z", "log": str(log),
          "log_sha256_16": hashlib.sha256(log.read_bytes()).hexdigest()[:16]}
    (d / f"{iid}-{tag}.json").write_text(json.dumps(ev, ensure_ascii=False), encoding="utf-8")
    if tamper:
        log.write_text("48 passed in 0.5s\n（事后被动过）\n", encoding="utf-8")
    return ev


def _qa_pass(yt, iid, tag):
    """QA 复验留痕评论（orchestrator 同格式：证据=<log 去 .log>.json）。"""
    log = CONFIG.evidence_dir / "STUDIO" / f"{iid}-{tag}.log"
    yt.comment(iid, f"复验通过 证据={str(log)[:-4]}.json commit=abc1234 加测=ok")


def _texts(be, iid):
    return [c["text"] for c in be.issues[iid]["comments"]]


def _steward_comments(be, iid):
    return [t for t in _texts(be, iid) if "框架管家" in t[:40]]


class Test收割校验逻辑:
    def test_证据三查_纯函数(self, tmp_config):
        """存在性/哈希完整性/结论绿+命令不漂移——verify_evidence 不碰 YouTrack。"""
        iid = "STUDIO-11"
        ok, pts, ev = steward.verify_evidence(iid, GATE)
        assert not ok and "证据文件缺失" in pts[0] and ev is None
        _write_ev(iid, "qa-1")
        ok, pts, ev = steward.verify_evidence(iid, GATE)
        assert ok and pts == [] and ev["exit"] == 0
        _write_ev(iid, "qa-2", tamper=True)
        ok, pts, _ = steward.verify_evidence(iid, GATE)
        assert not ok and any("哈希不一致" in p for p in pts)
        _write_ev(iid, "qa-3", exit=2)
        ok, pts, _ = steward.verify_evidence(iid, GATE)
        assert not ok and any("结论为红" in p for p in pts)
        _write_ev(iid, "qa-4", cmd="echo 旧命令")
        ok, pts, _ = steward.verify_evidence(iid, GATE)
        assert not ok and any("漂移" in p for p in pts)

    def test_不合格_评论退回要点(self, fake_yt, tmp_config):
        """缺证据/日志被改/结论红 → 各自退回要点评论（每单一条，含署名锚）。"""
        yt = YT("agent-8")
        a = _mk(yt)                                            # 无任何证据文件
        b = _mk(yt)
        _write_ev(b, "1", tamper=True)                         # 哈希失配
        c = _mk(yt)
        _write_ev(c, "1", exit=1)                              # 收割闸门红了（历史残留）
        out = steward.steward_tick()
        assert out["result"] == "OK"
        for iid, kw in ((a, "证据文件缺失"), (b, "哈希不一致"), (c, "结论为红")):
            assert any(a.startswith(f"STEWARD-BACK {iid}") for a in out["actions"])
            cs = _steward_comments(fake_yt, iid)
            assert len(cs) == 1 and cs[0].startswith(f"[STUDIO·框架管家·工程部] 管家退回要点：{iid}")
            assert kw in cs[0]


class Test宰相终验提醒:
    def test_合格_终验位评论_at_宰相(self, fake_yt, tmp_config):
        """复验通过（终验位）+证据三查全绿+QA留痕在卷 → @宰相(ZCode) 终验提醒，
        评论带署名协议头/证据名/exit=0，动作与记账事件齐。"""
        yt = YT("agent-8")
        iid = _mk(yt, state="复验通过")
        ev = _write_ev(iid, "qa-100")
        _qa_pass(yt, iid, "qa-100")
        out = steward.steward_tick()
        assert out["result"] == "OK" and f"STEWARD-REMIND {iid}" in out["actions"]
        cs = _steward_comments(fake_yt, iid)
        assert len(cs) == 1
        head, body = cs[0].splitlines()[0], cs[0]
        assert head.startswith(f"[STUDIO·框架管家·工程部] @宰相(ZCode) 终验提醒：{iid}")
        assert "请看板终验" in head
        assert f"STUDIO/{iid}-qa-100.json" in body and "exit=0" in body
        assert "哈希一致" in body and "QA 复验" in body
        evs = [json.loads(x) for x in
               CONFIG.events_path.read_text(encoding="utf-8").splitlines()]
        assert any(e["event"] == "STEWARD_REMIND" and e["issue"] == iid for e in evs)

    def test_合并审待批_同样提醒(self, fake_yt, tmp_config):
        """pm_tick 把复验通过挪进合并审待批后（路标评论在卷），管家照样认得终验位。"""
        yt = YT("agent-8")
        iid = _mk(yt, state="待批")
        _write_ev(iid, "qa-200")
        _qa_pass(yt, iid, "qa-200")
        yt.comment(iid, "复验通过，进入合并审")                  # pm_tick 结构性槽位路标
        out = steward.steward_tick()
        assert f"STEWARD-REMIND {iid}" in out["actions"]
        assert any("@宰相(ZCode) 终验提醒" in t for t in _steward_comments(fake_yt, iid))

    def test_QA复验留痕缺失_不提醒只退回(self, fake_yt, tmp_config):
        """终验位上 QA 结论评论缺失（复验链断）→ 宁退回不提醒——空结论=无结论。"""
        yt = YT("agent-8")
        iid = _mk(yt, state="复验通过")
        _write_ev(iid, "qa-300")                               # 证据全绿但无 QA 留痕
        out = steward.steward_tick()
        assert any(a.startswith(f"STEWARD-BACK {iid}") for a in out["actions"])
        assert any("QA 复验结论缺失" in t for t in _steward_comments(fake_yt, iid))


class Test幂等与辖区:
    def test_同证据只说一次_新收割自动复检(self, fake_yt, tmp_config):
        """同证据 tag 二拍静默（不刷屏）；退回重做产出新证据后自动再提醒。"""
        yt = YT("agent-8")
        iid = _mk(yt, state="复验通过")
        _write_ev(iid, "qa-1")
        _qa_pass(yt, iid, "qa-1")
        steward.steward_tick()
        out2 = steward.steward_tick()
        assert out2["result"] == "IDLE" and not out2["actions"]
        assert len(_steward_comments(fake_yt, iid)) == 1        # 无重复评论
        _write_ev(iid, "qa-2")                                  # 新一轮收割（新证据）
        _qa_pass(yt, iid, "qa-2")
        out3 = steward.steward_tick()
        assert f"STEWARD-REMIND {iid}" in out3["actions"]
        assert len(_steward_comments(fake_yt, iid)) == 2

    def test_辖区与位过滤(self, fake_yt, tmp_config):
        """非辖区泳道（core）/立项待批（无合并审路标）/L0 自动合并/证据就绪未复验——全静默。"""
        yt = YT("agent-8")
        core = _mk(yt, state="复验通过", lane="core")           # 泳道不在辖区
        _write_ev(core, "qa-1"); _qa_pass(yt, core, "qa-1")
        draft = _mk(yt, state="待批")                           # 立项批：无收割证据可查
        _write_ev(draft, "1")                                   # 即使有残留证据也不扰
        l0 = _mk(yt, state="复验通过", track="L0 自动")          # 自动合并，无终验位
        _write_ev(l0, "qa-1"); _qa_pass(yt, l0, "qa-1")
        mid = _mk(yt, state="证据就绪")                          # 收割绿但 QA 未复验：等复验
        _write_ev(mid, "1")
        out = steward.steward_tick()
        assert out["result"] == "IDLE" and not out["actions"]
        for iid in (core, draft, l0, mid):
            assert _steward_comments(fake_yt, iid) == []
