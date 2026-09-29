"""supervise 巡检：异常检测必须真的能抓到（防假绿）。"""
import sys
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from studio import supervise as sv


class TestConformance:
    def test_自评重复草稿报警(self, fake_yt):
        from studio.yt import YT
        yt = YT("agent-8")
        for i in range(2):
            yt.new("STUDIO", "[自评] 闸门失败率 55%（11/20）——检查 DoD", "d",
                   lane=None, typ="提案", track="G1 知识", state="草稿")
        out = []
        sv._anomalies_conformance(out)
        assert any(a["kind"] == "duplicate-drafts" for a in out), out

    def test_恒假gate与空gate报警(self, fake_yt):
        from studio.yt import YT
        yt = YT("agent-8")
        i1 = yt.new("STUDIO", "a", "d", lane=None, typ="需求", track="L1 首批", state="待批")
        yt.set_text(i1, "验收命令", "test -f /dev/null")
        i2 = yt.new("STUDIO", "b", "d", lane=None, typ="需求", track="L1 首批", state="待批")
        # i2 不设 gate → gate-missing
        out = []
        sv._anomalies_conformance(out)
        kinds = {a["kind"] for a in out}
        assert "gate-invalid" in kinds and "gate-missing" in kinds, out


class TestFirstSeg:
    def test_中文无空格_标点切分(self):
        assert sv._first_seg("可以的，排查仔细哈") == "可以的"
        assert sv._first_seg("批准。细节另说") == "批准"

    def test_非批准词不误报(self):
        assert sv._first_seg("好像不对，再想想") not in sv._APPROVE_ALIASES
        assert sv._first_seg("这个方案有问题") not in sv._APPROVE_ALIASES


class TestLoopDetection:
    def test_同类动作3次报警(self, tmp_path, monkeypatch):
        log = tmp_path / "daemon-test.log"
        import time
        now = time.strftime("%F %T")
        log.write_text(
            "\n".join([
                f"{now} [STUDIO] TICK {{\"result\": \"OK\", \"actions\": [\"ORPHAN STUDIO-14\"]}}",
                f"{now} [STUDIO] TICK {{\"result\": \"OK\", \"actions\": [\"ORPHAN STUDIO-14\"]}}",
                f"{now} [STUDIO] TICK {{\"result\": \"OK\", \"actions\": [\"ORPHAN STUDIO-14\"]}}",
                f"{now} [STUDIO] TICK {{\"result\": \"OK\", \"actions\": [\"DISPATCH STUDIO-14 lane=x\"]}}",
            ]), encoding="utf-8")
        monkeypatch.setattr(sv, "TODAY_LOG", log)
        out = []
        sv._anomalies_loops(out)
        assert any(a["kind"] == "action-loop" and a["issue"] == "STUDIO-14" for a in out)

    def test_两岁以下不报(self, tmp_path, monkeypatch):
        log = tmp_path / "daemon-test.log"
        import time
        old = time.strftime("%F %T", time.localtime(time.time() - 86400))
        log.write_text(f"{old} [STUDIO] TICK {{\"actions\": [\"ORPHAN STUDIO-14\"]}}", encoding="utf-8")
        monkeypatch.setattr(sv, "TODAY_LOG", log)
        out = []
        sv._anomalies_loops(out)
        assert not out


class TestApprovalUnconsumed:
    def test_待批有未消费批准_必须报警(self, fake_yt):
        from studio.yt import YT
        from studio import statemachine as sm
        yt = YT("agent-8")
        iid = yt.new("POLY", "t", "d", lane="core", typ="需求", track="L1 首批")
        yt.transition(iid, "待批")
        fake_yt.issues[iid]["comments"].append(
            {"author": "opengames", "text": "可以的，按这个来", "created": fake_yt.now_ms()})
        out = []
        sv._anomalies_tickets(out)
        assert any(a["kind"] == "approval-unconsumed" and a["issue"] == iid for a in out), out

    def test_已消费不报(self, fake_yt):
        from studio.yt import YT
        yt = YT("agent-8")
        iid = yt.new("POLY", "t2", "d", lane="core", typ="需求", track="L1 首批")
        yt.transition(iid, "待批")
        fake_yt.issues[iid]["comments"].append(
            {"author": "opengames", "text": "批准", "created": fake_yt.now_ms()})
        fake_yt.issues[iid]["comments"].append(
            {"author": "agent-8", "text": "批示已执行 approve → 已派发 (第1批)", "created": fake_yt.now_ms()})
        out = []
        sv._anomalies_tickets(out)
        assert not any(a["kind"] == "approval-unconsumed" for a in out), out
