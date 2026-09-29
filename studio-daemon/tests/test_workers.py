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


# ---------------------------------------------------------------- 人事四要素注入（STUDIO-82）
def _fake_org(monkeypatch, agents: dict, bu: dict | None = None):
    """org.yaml 替身：不读盘（真文件内容随编制演进，断言不锚定生产数据）。"""
    from studio import org
    monkeypatch.setattr(org, "load", lambda *a, **k: {
        "version": 1, "projects": {"STUDIO": {"agents": agents, "bu": bu or {}}}})


def _tpl_kw() -> dict:
    """WORKER_TEMPLATE 全占位字典（渲染集成断言用）。"""
    return dict(title="程序 worker", role="agent-dev", issue="STUDIO-99",
                wteam="全局/团队公约", team="公约正文", profile="档案正文",
                wcommon="手册/worker-common", common="手册正文",
                summary="标题", desc="描述", track="L2 常规", lane="core", type="需求",
                attempt=0, gate="pytest -q", repo="/r", branch="feature/STUDIO-99",
                gwhost="127.0.0.1:8787", report="/r/REPORT.md",
                producer_notes="（无额外批注）", projid="0-2", yturl="http://localhost:8080")


def test_任务书注入人事四要素(tmp_config, monkeypatch):
    """STUDIO-82 验收①：身份匹配（worker池.身份=agent-dev）→ 任务书含部门/角色/职责/上级。"""
    from studio.workers import WORKER_TEMPLATE, org_profile_block
    _fake_org(monkeypatch,
              {"worker池": {"level": 1, "部门": ["工程部"], "角色": "施工执行",
                            "上级": "宰相(ZCode)", "身份": "agent-dev"}},
              {"工程部": {"职能": "开发/修bug/重构"}})
    blk = org_profile_block("agent-dev")
    assert "部门: 工程部" in blk and "角色: 施工执行" in blk
    assert "职责: 开发/修bug/重构" in blk and "上级: 宰相(ZCode)" in blk
    prompt = WORKER_TEMPLATE.format(org_profile=blk, **_tpl_kw())   # 落位：角色档案之后、手册之前
    i_prof, i_org, i_common = (prompt.index(x) for x in ("角色档案", "人事档案", "worker 通用手册"))
    assert i_prof < i_org < i_common


def test_无部门时行为不变(tmp_config, monkeypatch):
    """STUDIO-82 验收②：查无档案（策划/美术等未入编身份）或档案无部门 → 不注入，任务书与旧版一致。"""
    from studio.workers import WORKER_TEMPLATE, org_profile_block
    _fake_org(monkeypatch,                       # agent-6 不在 agents 段
              {"worker池": {"level": 1, "角色": "施工执行", "身份": "agent-dev",
                            "上级": "宰相(ZCode)"}},                 # 且本档案缺 部门 字段
              {"工程部": {"职能": "开发"}})
    assert org_profile_block("agent-6") == ""            # 无档案 → 空
    assert org_profile_block("agent-dev") == ""          # 有档案无部门 → 仍空（不注入半截信息）
    prompt = WORKER_TEMPLATE.format(org_profile="", **_tpl_kw())
    assert "人事档案" not in prompt
    assert prompt.count("# ══════") == 3                 # 仍是公约/角色档案/手册三节，无空壳节
    assert "\n\n\n" not in prompt                        # 占位消失无残行（逐字节同旧版）


def test_个体名直存与多部门联署(tmp_config, monkeypatch):
    """STUDIO-82 验收③（鲁棒性）：键名直接命中；多部门职责带前缀聚合、上级列表并署、bu 缺失不炸。"""
    from studio.workers import org_profile_block
    _fake_org(monkeypatch,
              {"双料特工": {"level": 2, "部门": ["工程部", "质量部", "神秘部"],
                            "角色": "联署施工", "上级": ["宰相(ZCode)", "opengames"]},
               "质量员": {"部门": "质量部", "角色": "测试", "上级": "自评引擎"}},  # 部门写字符串也兼容
              {"工程部": {"职能": "开发"}, "质量部": {"职能": "测试/复盘"}})
    blk = org_profile_block("双料特工")                  # 无身份/login 字段 → 键名匹配
    assert "部门: 工程部、质量部、神秘部" in blk
    assert "职责: 工程部:开发；质量部:测试/复盘；神秘部:（职能未登记）" in blk
    assert "上级: 宰相(ZCode)、opengames" in blk
    assert "部门: 质量部" in org_profile_block("质量员") \
        and "职责: 测试/复盘" in org_profile_block("质量员")   # 单部门职责不带前缀
