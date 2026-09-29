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


# ---- STUDIO-79 修复：wkey 签发断链 ----
# ac12fe1（网关收权）只建了校验端（web._worker_key_ok 读 reg 的 wkey），签发端从未
# 接线——reg 无 wkey、wrap 不导出 STUDIO_WKEY，worker 心跳/评论/文章一律 403。
# 下方两例补齐断链回归：launch 签发（reg 钉存 + wrap 导出）→ 网关端到端放行。

def test_wrap_导出网关凭证(tmp_config):
    s = wrap_script("T-20", "/tmp/repo", "/tmp/p.md", "/tmp/s.jsonl", "/usr/bin/claude",
                    wkey="wk-abc123")
    assert 'export STUDIO_WKEY="wk-abc123"' in s
    # 旧调用兼容：无凭证导出空串（网关 _worker_key_ok 的 bool(key) 对空 key fail-closed 拒）
    assert 'export STUDIO_WKEY=""' in wrap_script("T-21", "/r", "/p", "/s", "/c")


def test_launch签发wkey_网关端到端放行(tmp_config, fake_yt, lanes, monkeypatch):
    import json as _json
    from studio import workers as W
    from studio.workers import Worker
    from studio.yt import YT
    monkeypatch.setattr(W.subprocess, "Popen",     # 不真拉起 wrap（测试进程内不跑 claude）
                        lambda *a, **k: type("P", (), {"pid": -1})())
    yt = YT("agent-8")
    iid = yt.new("STUDIO", "wkey签发", "d", lane="core", typ="需求", track="L2 常规")
    Worker(iid).launch(yt.get(iid), "core")
    reg = _json.loads((CONFIG.workers_dir / f"{iid}.json").read_text(encoding="utf-8"))
    assert reg["wkey"].startswith("wk-") and len(reg["wkey"]) == 3 + 32   # wk- + 32 hex
    wrap = (CONFIG.workers_dir / f"{iid}.wrap.sh").read_text(encoding="utf-8")
    assert f'export STUDIO_WKEY="{reg["wkey"]}"' in wrap
    # 端到端：持 reg 里的 wkey 过网关心跳 → 板面「心跳」字段真实落值
    from fastapi.testclient import TestClient
    from studio import web
    client = TestClient(web.app, base_url=f"http://127.0.0.1:{CONFIG.web_port}")
    assert client.post("/api/yt/heartbeat",
                       json={"iid": iid, "key": reg["wkey"]}).json()["ok"]
    assert int(yt.f(iid, "心跳")) > 0


# ---- STUDIO-77：wkey 签发补全（三类执行体统一网关） ----

def test_launch_explore泳道同样签发wkey(tmp_config, fake_yt, lanes, monkeypatch):
    """explore 泳道 worker 与交付泳道同一 launch 链——凭证不因泳道缺席（STUDIO-77 验收：
    三类执行体全走网关；explore 直连 YouTrack 的旧教学随模板收口一并消失）。"""
    import json as _json
    from studio import workers as W
    from studio.workers import Worker
    from studio.yt import YT
    monkeypatch.setattr(W.subprocess, "Popen",
                        lambda *a, **k: type("P", (), {"pid": -1})())
    yt = YT("agent-8")
    iid = yt.new("STUDIO", "explore签发", "d", lane="explore", typ="需求", track="L2 常规")
    Worker(iid).launch(yt.get(iid), "explore")
    reg = _json.loads((CONFIG.workers_dir / f"{iid}.json").read_text(encoding="utf-8"))
    assert reg["wkey"].startswith("wk-") and len(reg["wkey"]) == 3 + 32
    wrap = (CONFIG.workers_dir / f"{iid}.wrap.sh").read_text(encoding="utf-8")
    assert f'export STUDIO_WKEY="{reg["wkey"]}"' in wrap


def test_任务书只教网关_无直连YouTrack教学(tmp_config):
    """STUDIO-77 直连收口：任务书不再教 Bearer token 直发 /api/articles——
    Article 草稿唯一路径=网关 /api/yt/article（worker 拿不到也不该知道 token 用法）。"""
    from studio.workers import WORKER_TEMPLATE
    assert "Bearer" not in WORKER_TEMPLATE
    assert "/api/articles" not in WORKER_TEMPLATE          # 直连端点（复数）不再出现
    assert "/api/yt/article" in WORKER_TEMPLATE            # 网关端点仍教
    assert "/api/yt/heartbeat" in WORKER_TEMPLATE
