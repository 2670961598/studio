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
    yt = YT("agent-8")
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
    yt = YT("agent-8")
    iid = _ticket(fake_yt, yt, lanes, "exit 7")
    res = run_gate(iid, "1", "core")
    assert not res.ok and res["exit"] == 7


def test_缺命令报错(fake_yt, lanes):
    from studio.yt import YT
    yt = YT("agent-8")
    iid = yt.new("POLY", "g", "d", lane="core")
    with pytest.raises(RuntimeError, match="GATE-NO-CMD"):
        run_gate(iid, "1", "core")


def test_危险命令拒跑不执行(fake_yt, lanes):
    """第四批：验收命令可被手工设置（绕过 dod_gen 白名单）——run_gate 执行前
    危险快筛兜底，命中即 raise（TICK ERROR 留痕，不执行、不计 attempt）。"""
    import pytest as _pytest
    from studio.yt import YT
    yt = YT("agent-8")
    iid = _ticket(fake_yt, yt, lanes, "rm -rf /tmp/evil && test -f docs/hello.md")
    with _pytest.raises(RuntimeError, match="GATE-DANGEROUS"):
        run_gate(iid, "1", "core")
    iid2 = _ticket(fake_yt, yt, lanes, "test -f docs/hello.md && cat /etc/passwd")
    with _pytest.raises(RuntimeError, match="GATE-DANGEROUS"):
        run_gate(iid2, "1", "core")


def test_手工合法范式不误杀(fake_yt, lanes):
    """存量手工 gate 范式（cd 仓库绝对路径 && node 脚本）不在危险特征内，照跑。"""
    from studio.yt import YT
    yt = YT("agent-8")
    from studio.config import CONFIG
    repo = CONFIG.lane("core")["path"]
    iid = _ticket(fake_yt, yt, lanes, f"cd {repo} && test -f docs/hello.md")
    res = run_gate(iid, "1", "core")
    assert res.ok is True


def test_手工命令for循环与重定向不再误杀(fake_yt, lanes):
    """GAMES-84 实录：cd /abs && for g in ...（含 shell 正常语法）曾被快筛误杀卡单。
    快筛只挡破坏/注入原语，放行手工合法语法。"""
    from studio.yt import YT
    import pytest as _pt
    yt = YT("agent-8")
    # /usr/bin/true 秒退（node 形态实测 85s——node 解析不存在脚本出奇慢）
    from studio.config import CONFIG as _C
    _repo = _C.lane("core")["path"]
    iid = _ticket(fake_yt, yt, lanes, f"cd {_repo} && /usr/bin/true net-tank && /usr/bin/true slg-battlefield")
    from studio.gates import run_gate
    # repo 参数：core 沙箱 repo 下这些文件不存在 → gate 会跑但 exit≠0——重点是不再 GATE-DANGEROUS 拒跑
    try:
        run_gate(iid, "1", "core")
    except RuntimeError as e:
        assert "GATE-DANGEROUS" not in str(e), "合法手工命令不得再被快筛拒跑"


class TestPoly53TildeNarrowing:
    """STUDIO-98（POLY-53 实录 2026-10-05 05:20）：dotnet FQN 过滤器
    `--filter "FullyQualifiedName~X"` 语法必含中缀 ~，撞上派发闸裸 "~" 通配
    → GATE-DANGEROUS 拒跑，巡逻孵化单出生即不可交付、烧 attempt 至断路。"""

    def test_FQN过滤器中缀波浪号过闸(self, fake_yt, lanes):
        """①POLY-53 原形态命令两道闸都必须放行（出生=消毒器，交付=派发闸）；
        test -f 沙箱内不存在 → && 短路秒退，不真跑 dotnet。"""
        from studio.yt import YT
        from studio.llm import _sanitize_cmd
        cmd = ('test -f Tests/Game/LevelsIndexDocTests.cs && '
               'dotnet test Tests/PolyMatch3.Tests.csproj --filter "FullyQualifiedName~LevelsIndexDocTests"')
        assert _sanitize_cmd(cmd) == cmd, "出生闸（消毒器）必须放行"
        yt = YT("agent-8")
        iid = _ticket(fake_yt, yt, lanes, cmd)
        res = run_gate(iid, "1", "core")     # 不再 GATE-DANGEROUS 拒跑
        assert not res.ok                    # test -f 短路 → exit 1，无妨：过闸即本案判据

    def test_家目录路径形态拒跑(self, fake_yt, lanes):
        """②词表收窄只放中缀 ~：家目录路径 ~/ 照拦。"""
        from studio.yt import YT
        yt = YT("agent-8")
        iid = _ticket(fake_yt, yt, lanes, "test -f ~/secrets")
        with pytest.raises(RuntimeError, match="GATE-DANGEROUS"):
            run_gate(iid, "1", "core")

    def test_rm破坏原语拒跑_回归锚(self, fake_yt, lanes):
        """③回归锚：rm 破坏原语照拒——收窄 ~ 不得波及其他词。"""
        from studio.yt import YT
        yt = YT("agent-8")
        iid = _ticket(fake_yt, yt, lanes, "rm -f /tmp/x && test -f docs/hello.md")
        with pytest.raises(RuntimeError, match="GATE-DANGEROUS"):
            run_gate(iid, "1", "core")

    def test_出生交付两闸词表同源子集(self):
        """铁律锁：派发闸词表 ⊆ 消毒器词表（凡出生放行的必须可交付）。
        POLY-53 根因②即两表各自内联散写漂移——同源引用后此断言锁死再漂移。"""
        from studio.screen_words import GATE_DANGER, CMD_BLACKLIST
        assert set(GATE_DANGER) <= set(CMD_BLACKLIST)
        assert "~" not in GATE_DANGER and "~/" in GATE_DANGER   # 裸 ~ 通配不复存
