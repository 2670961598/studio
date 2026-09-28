"""worker 约束三件套（审计 P0-3）：固定模型 + 预算帽 + wall-clock 看门狗。
三件套曾只修在已废弃的 ~/bin/studio-worker（bash 死代码）上——现行 Python Worker
无 --model（违反宪章 §6"一律显式 --model"）、无预算帽、无看门狗（心跳制 90min 且
持续心跳则永不封顶）。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from studio.config import CONFIG                     # noqa: E402
from studio.workers import wrap_script               # noqa: E402


def test_wrap_三件套齐全(tmp_config):
    s = wrap_script("T-1", "/tmp/repo", "/tmp/p.md", "/tmp/s.jsonl", "/usr/bin/claude")
    assert '--model "glm-5.3"' in s                  # 固定主力模型（宪章 §6）
    assert "--max-budget-usd 15.0" in s or "--max-budget-usd 15" in s   # 单次预算帽
    assert "sleep 2700" in s and "kill -TERM $CPID" in s                # 45min 看门狗
    assert "WORKER-EXIT=$RC" in s                    # 退出码照旧入 stream


def test_wrap_参数可调(tmp_config, monkeypatch):
    monkeypatch.setattr(CONFIG, "worker_model", "glm-5.3-air")
    monkeypatch.setattr(CONFIG, "worker_max_budget_usd", 8.5)
    monkeypatch.setattr(CONFIG, "worker_wall_timeout_s", 600)
    s = wrap_script("T-2", "/r", "/p", "/s", "/c")
    assert '--model "glm-5.3-air"' in s and "--max-budget-usd 8.5" in s
    assert "sleep 600" in s


def test_未登记执行器报错不静默(tmp_config):
    """47-C 纪律：新执行器必须先沙箱验证参数面并登记——未登记的启动即报错。"""
    import pytest
    from studio.workers import wrap_script
    with pytest.raises(RuntimeError, match="未知执行器 'codex'"):
        wrap_script("T-9", "/r", "/p", "/s", "/c", executor="codex")


def test_claude执行器三件套不变(tmp_config):
    from studio.workers import wrap_script
    s = wrap_script("T-10", "/r", "/p", "/s", "/c", executor="claude")
    assert '--model "glm-5.3"' in s and "--max-budget-usd" in s and "sleep 2700" in s
