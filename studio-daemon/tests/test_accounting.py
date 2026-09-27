"""记账接线（审计 P0-1）：worker result 三元组解析/归档钉存/收割入账/岗哨时长配对。
GAMES-40 实录：stream 里明躺 total_cost_usd=16.48、duration_ms=2683795，
但四条接线全断——数据在，账本没有。"""
import json, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from studio.config import CONFIG                     # noqa: E402
from studio.workers import Worker                    # noqa: E402
from studio.runs import DurationTracker              # noqa: E402


def _mk_stream(iid, result: dict):
    w = Worker(iid)
    w.stream.parent.mkdir(parents=True, exist_ok=True)
    lines = [json.dumps({"type": "user", "message": "go"}, ensure_ascii=False),
             json.dumps(dict(type="result", **result), ensure_ascii=False)]
    w.stream.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return w


def test_result_stats_三元组解析(tmp_config):
    w = _mk_stream("T-1", {"total_cost_usd": 1.25, "duration_ms": 61000,
                           "num_turns": 7, "session_id": "s1",
                           "usage": {"input_tokens": 100, "output_tokens": 40}})
    rs = w.result_stats()
    assert rs["cost_usd"] == 1.25 and rs["duration_ms"] == 61000
    assert rs["tokens"] == 140 and rs["turns"] == 7 and rs["session_id"] == "s1"


def test_result_stats_字段名漂移回退(tmp_config):
    """真实样本 STUDIO-14 用 duration_api_ms；GAMES-40 用 duration_ms——都认。"""
    w = _mk_stream("T-2", {"total_cost_usd": 0.94, "duration_api_ms": 228441,
                           "usage": {"input_tokens": 40656, "output_tokens": 13762}})
    rs = w.result_stats()
    assert rs["duration_ms"] == 228441 and rs["tokens"] == 54418


def test_result_stats_缺文件无result为空(tmp_config):
    assert Worker("T-3").result_stats() == {}
    w = _mk_stream("T-4", {})                       # 有文件但没写 result 行
    w.stream.write_text(json.dumps({"type": "user"}) + "\n", encoding="utf-8")
    assert w.result_stats() == {}


def test_archive_把记账钉进done_json(tmp_config):
    w = _mk_stream("T-5", {"total_cost_usd": 2.0, "duration_ms": 1000,
                           "usage": {"input_tokens": 1, "output_tokens": 1}})
    w.reg.parent.mkdir(parents=True, exist_ok=True)
    w.reg.write_text(json.dumps({"issue": "T-5", "pid": -1}), encoding="utf-8")
    w.report.write_text("R", encoding="utf-8")
    w.archive()
    done = json.loads((CONFIG.workers_dir / "T-5.done.json").read_text(encoding="utf-8"))
    assert done["result"]["cost_usd"] == 2.0        # stream 改名后记账仍可读
    assert not w.stream.exists() and not w.reg.exists()


def test_duration_tracker_配对与清零(tmp_config):
    t = DurationTracker()
    t.submitted("j1")
    time.sleep(0.02)
    assert t.settle("j1") >= 20                     # 毫秒级测出
    assert t.settle("j1") == 0                      # 结清后不复用
    t.submitted("j2")
    t.drop("j2")                                    # MISSED：从未起跑，丢弃防脏配对
    assert t.settle("j2") == 0
    assert t.settle("从未提交") == 0
