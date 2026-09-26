"""reports 运营报告：全部来自落盘事实；知识库发布幂等；发布失败不致命。
种子：events/runs/daemon日志/self-eval digest 各造一份，YT 换桩。"""
import json, os, subprocess, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import studio.reports as R                               # noqa: E402
from studio.config import CONFIG                         # noqa: E402

TODAY = time.strftime("%F")


def _seed():
    evs = [
        {"ts": f"{TODAY} 09:00:00", "pid": "GAMES", "issue": "G-1", "event": "DISPATCH",
         "actor": "a", "attempt": 0, "note": ""},
        {"ts": f"{TODAY} 10:00:00", "pid": "GAMES", "issue": "G-1", "event": "GATE_PASS",
         "actor": "a", "attempt": 0, "note": ""},
        {"ts": f"{TODAY} 11:00:00", "pid": "GAMES", "issue": "G-2", "event": "GATE_FAIL",
         "actor": "a", "attempt": 0, "note": ""},
        {"ts": f"{TODAY} 12:00:00", "pid": "GAMES", "issue": "G-3", "event": "QA_BACK",
         "actor": "a", "attempt": 0, "note": ""},
        {"ts": f"{TODAY} 13:00:00", "pid": "POLY", "issue": "POLY-18", "event": "PATROL",
         "actor": "patrol", "attempt": 0, "note": "2 子单；性能热点收敛"},
    ]
    CONFIG.events_path.write_text(
        "\n".join(json.dumps(e, ensure_ascii=False) for e in evs) + "\n", encoding="utf-8")
    runs = CONFIG.events_path.parent / "runs.jsonl"
    runs.write_text(
        json.dumps({"ts": f"{TODAY} 09:07:00", "job": "pm-games", "name": "子PM",
                    "outcome": "ok", "duration_ms": 0, "summary": "OK"}, ensure_ascii=False) + "\n" +
        json.dumps({"ts": f"{TODAY} 09:30:00", "job": "pm-poly", "name": "子PM",
                    "outcome": "error", "duration_ms": 0, "summary": "ValueError: x"},
                   ensure_ascii=False) + "\n", encoding="utf-8")
    (CONFIG.logs_dir / f"daemon-{TODAY}.log").write_text(
        f"{TODAY} 07:50:00 [POLY] ERROR POLY-22 非法迁移 新单 → 已派发\n"
        f"{TODAY} 07:50:00 [POLY] ERROR POLY-23 非法迁移 新单 → 已派发\n"
        f"{TODAY} 08:00:00 [POLY] TICK ok\n"
        f"{TODAY} 09:20:25 [llm] ask FAILED model=glm-5.3 timed out after 600 seconds\n"
        f"{TODAY} 09:30:25 [POLY] TICK {{\"result\": \"OK\", \"actions\": "
        f"[\"ERROR POLY-23 非法迁移 新单 → 已派发\"]}}\n", encoding="utf-8")
    (CONFIG.digest_dir / f"self-eval-{TODAY}.json").write_text(
        json.dumps({"findings": ["断路触发 2 次——相关单需人工复盘"]}, ensure_ascii=False),
        encoding="utf-8")


class _FakeYT:
    def __init__(self):
        self.published = []

    def wiki_create(self, path, content, pid="STUDIO"):
        self.published.append(path)
        return "STUDIO-A-1"

    def list(self, pid, q):
        return [{"id": "STUDIO-36", "summary": "[自评] QA 打回率", "state": "草稿"}]


def test_日报六段事实齐全且发布知识库(tmp_config, monkeypatch):
    _seed()
    fake = _FakeYT()
    monkeypatch.setattr(R, "_yt", lambda: fake)
    res = R.daily_report()
    assert res["result"] == "OK"
    assert fake.published == [f"运营日报/{TODAY}"]
    md = (CONFIG.events_path.parent / "reports" / f"daily-{TODAY}.md").read_text(encoding="utf-8")
    assert "派发 1" in md and "失败率 50%" in md      # 指标段（1过1败）
    assert "×2" in md                                 # 同模式 ERROR 归并成一条（TICK 回显行被过滤，不计成 ×3）
    assert "ask FAILED" in md                         # LLM 岛超时（不带 ERROR 字样）必须进日报
    assert "断路触发" in md                            # 自评发现
    assert "POLY-18" in md and "性能热点收敛" in md      # 巡逻进展
    assert "STUDIO-36" in md                          # 待决提案
    assert "pm-poly" in md and "异常×1" in md           # 岗哨异常可见


def test_知识库发布失败不致命仍落本地(tmp_config, monkeypatch):
    _seed()

    class _Boom:
        def wiki_create(self, *a, **k):
            raise RuntimeError("net down")

        def list(self, *a, **k):
            return []

    monkeypatch.setattr(R, "_yt", lambda: _Boom())
    res = R.daily_report()
    assert res["result"] == "OK"
    assert "失败:RuntimeError" in res["actions"][0]
    assert (CONFIG.events_path.parent / "reports" / f"daily-{TODAY}.md").exists()


def test_周报月报落盘(tmp_config, monkeypatch):
    _seed()
    monkeypatch.setattr(R, "_yt", lambda: _FakeYT())
    assert R.weekly_report()["result"] == "OK"
    assert R.monthly_report()["result"] == "OK"
    rp = CONFIG.events_path.parent / "reports"
    assert any(rp.glob("weekly-*.md")) and any(rp.glob("monthly-*.md"))


def test_空数据不炸都写无(tmp_config, monkeypatch):
    monkeypatch.setattr(R, "_yt", lambda: _FakeYT())
    res = R.daily_report()
    assert res["result"] == "OK"
    md = (CONFIG.events_path.parent / "reports" / f"daily-{TODAY}.md").read_text(encoding="utf-8")
    assert "- 无" in md                                   # ERROR/自评/巡逻/git 段兜底


def test_根路径环境变量隔离():
    """实验场隔离的地基：STUDIO_ROOT 一换，kernel 状态根跟着换。
    骨架照 lab-init 的做法：kernel/youtrack-ids.json 起步拷一份。"""
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        k = Path(td) / "kernel"
        k.mkdir()
        (k / "youtrack-ids.json").write_text(
            json.dumps({"projects": {}}), encoding="utf-8")
        env = dict(os.environ, STUDIO_ROOT=td)
        out = subprocess.run(
            [sys.executable, "-c",
             "from studio.config import KERNEL, STUDIO_ROOT; print(STUDIO_ROOT, KERNEL)"],
            env=env, capture_output=True, text=True,
            cwd=str(Path(__file__).resolve().parent.parent))
        assert f"{td} {td}/kernel" in out.stdout, out.stderr
