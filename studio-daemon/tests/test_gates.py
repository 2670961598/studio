"""gates：证据 JSON 字段兼容性（与 bash run-gate 历史格式逐字段对齐）。"""
import json, sys
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from studio.gates import run_gate


def _ticket(fake_yt, yt, repo, cmd):
    iid = yt.new("POLY", "gate", "d", lane="core", typ="需求", track="L0 自动")
    yt.gate_freeze(iid, cmd)
    return iid


def test_证据格式_与bash版兼容(fake_yt, lanes):
    from studio.yt import YT
    yt = YT("agent-pm")
    iid = _ticket(fake_yt, yt, lanes, "test -f docs/hello.md")
    res = run_gate(iid, "1", "core")
    ev = json.loads(Path(res["log"][:-4] + ".json").read_text())
    # bash 版字段逐一在场且类型正确
    assert ev["issue"] == iid and ev["project"] == "POLY"
    assert isinstance(ev["attempt"], str)                 # 历史：jq --arg → str
    assert ev["lane"] == "core" and ev["branch"] == "main"
    assert ev["exit"] == 0 and ev["cmd"].startswith("test -f")
    assert ev["log"].endswith(".log")
    assert len(ev["log_sha256_16"]) == 16
    assert res.ok


def test_失败命令_exit透传(fake_yt, lanes):
    from studio.yt import YT
    yt = YT("agent-pm")
    iid = _ticket(fake_yt, yt, lanes, "exit 7")
    res = run_gate(iid, "1", "core")
    assert not res.ok and res["exit"] == 7


def test_缺命令报错(fake_yt, lanes):
    from studio.yt import YT
    yt = YT("agent-pm")
    iid = yt.new("POLY", "g", "d", lane="core")
    with pytest.raises(RuntimeError, match="GATE-NO-CMD"):
        run_gate(iid, "1", "core")
