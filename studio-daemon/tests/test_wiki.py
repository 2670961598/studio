"""wiki：YouTrack Articles 知识库（STUDIO-13 迁移后的档案唯一事实源）。
覆盖 yt.wiki_* 三方法 + workers.fetch_profile 兜底链 + launch 注入组装。"""
import sys
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from studio.yt import YT
from studio import workers


def test_wiki_create_逐级建父并按路径取回(fake_yt):
    t = YT("agent-8")
    aid = t.wiki_create("全局/团队公约", "# 团队公约\n红线：禁自批。")
    assert aid
    assert t.wiki_get("全局/团队公约") == "# 团队公约\n红线：禁自批。"
    assert "全局" in t.wiki_all()                    # 父节点「全局」已自动补建


def test_wiki_create_幂等重跑等于更新(fake_yt):
    t = YT("agent-8")
    t.wiki_create("手册/worker-common", "v1")
    t.wiki_create("手册/worker-common", "v2")
    assert t.wiki_get("手册/worker-common") == "v2"
    arts = t.wiki_all()
    assert len([p for p in arts if p == "手册/worker-common"]) == 1   # 没有建重


def test_wiki_get_未知路径抛KeyError(fake_yt):
    t = YT("agent-8")
    with pytest.raises(KeyError):
        t.wiki_get("编制/不存在")


def test_fetch_profile_优先articles_失配回退本地(fake_yt, tmp_path, monkeypatch):
    t = YT("agent-8")
    aid = t.wiki_create("编制/worker", "档案-来自Articles")
    assert workers.fetch_profile(t, "编制/worker") == "档案-来自Articles"
    del fake_yt.articles[aid]                        # Articles 侧丢失 → 走本地兜底
    fb = tmp_path / "agents" / "worker.md"           # 迁移前旧路径（kernel/agents/，git 史可考）
    fb.parent.mkdir()
    fb.write_text("档案-本地兜底", encoding="utf-8")
    monkeypatch.setitem(workers.LEGACY_FILES, "编制/worker", fb)
    assert workers.fetch_profile(t, "编制/worker") == "档案-本地兜底"


def test_launch_任务书注入公约档案手册(fake_yt, lanes, monkeypatch):
    t = YT("agent-8")
    t.wiki_create("全局/团队公约", "# 团队公约 —— 名册与红线")
    t.wiki_create("编制/worker", "# 执行层 worker 档案")
    t.wiki_create("手册/worker-common", "# worker-common 唯一规范")
    from studio import llm
    monkeypatch.setattr(llm, "_claude_bin", lambda: "/bin/true")
    monkeypatch.setattr(workers.subprocess, "Popen",
                        lambda *a, **k: type("P", (), {"pid": 4321})())
    iid = fake_yt.create("STUDIO", "迁移后派工", "描述", {
        "State": "已排期", "Type": "需求", "轨道": "L2 常规", "attempt": 0})
    w = workers.Worker(iid)
    w.launch(t.get(iid), "core")
    prompt = w.prompt.read_text(encoding="utf-8")
    assert "# 团队公约 —— 名册与红线" in prompt          # 三段知识库全部注入任务书
    assert "# 执行层 worker 档案" in prompt
    assert "# worker-common 唯一规范" in prompt
    assert "/Volumes/BigDisk/Studio/kernel/TEAM.md" not in prompt   # 不再引用已删的本地文件
