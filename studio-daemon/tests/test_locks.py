"""locks：mkdir 原子性语义/TTL 接管/owner 校验/beat——与 bash 版互操作的根基。"""
import sys, time
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from studio.locks import DirLock, LockBusy
from studio.config import CONFIG


def mk(tmp_path, name="t"):
    return DirLock(tmp_path / "locks", name)


def test_获取与释放(tmp_path):
    lk = mk(tmp_path)
    lk.acquire("A", 10)
    assert lk.path.is_dir()
    assert lk.check(10).startswith("HELD A")
    assert lk.release("A") == "RELEASED"
    assert lk.check(10) == "FREE"


def test_互斥(tmp_path):
    a, b = mk(tmp_path, "x"), mk(tmp_path, "x")
    a.acquire("A", 10)
    with pytest.raises(LockBusy):
        b.acquire("B", 10)


def test_ttl_过期可接管(tmp_path, monkeypatch):
    a = mk(tmp_path)
    a.acquire("A", 1)
    # 伪造 ts 为 2 分钟前
    (a.path / "ts").write_text(str(int(time.time()) - 120))
    b = mk(tmp_path, "x")
    b.acquire("B", 1)                      # 过期接管
    assert b.check(1).startswith("HELD B")


def test_owner_不符拒绝释放(tmp_path):
    a = mk(tmp_path, "x")
    a.acquire("A", 10)
    with pytest.raises(PermissionError):
        mk(tmp_path, "x").release("B")     # 另一实例持不同 owner
    a.release("A")                         # 正主能放


def test_beat_续期(tmp_path):
    lk = mk(tmp_path)
    lk.acquire("A", 1)
    (lk.path / "ts").write_text(str(int(time.time()) - 120))
    lk.beat()
    assert lk.check(1).startswith("HELD A")   # 续期后未过期


def test_死进程锁自动接管(tmp_path):
    """daemon 崩溃/被 kill 后锁残留（09-22 实录：tick-GAMES 死锁盲窗 4h）——
    锁上 pid 已死 → 接管；pid 活着（哪怕无权限探测）→ 仍 LockBusy。"""
    import os
    lk = mk(tmp_path, "dead")
    lk.acquire("tick-x", 10)
    dead = os.fork()                       # 造一个立刻退出的 pid
    if dead == 0:
        os._exit(0)
    os.waitpid(dead, 0)
    (lk.path / "pid").write_text(str(dead))
    b = mk(tmp_path, "dead")
    b.acquire("tick-y", 10)                # 持锁 pid 已死 → 直接接管，不抛 LockBusy
    assert b.check(10).startswith("HELD tick-y")
    live = lk.path.joinpath("pid")         # 活 pid：用当前进程
    live.write_text(str(os.getpid()))
    b.release("tick-y")
    lk2 = mk(tmp_path, "dead2")
    lk2.acquire("tick-z", 10)
    lk2.path.joinpath("pid").write_text(str(os.getpid()))
    with pytest.raises(LockBusy):
        mk(tmp_path, "dead2").acquire("tick-w", 10)   # 活着 → 拒绝


def test_泳道锁跨项目同仓互斥(tmp_config):
    """审计 P0-4 回归网：锁名只按 lane（物理仓），不带 pid——
    GAMES 与 POLY 用同名 lane 时必须互斥（曾经各持 lane-GAMES-core /
    lane-POLY-core 两把锁互不设防，同棵工作树互相 checkout/reset）。"""
    from studio.locks import LockBusy
    a = DirLock(CONFIG.locks_dir, "lane-core")
    a.acquire("worker-POLY-1", 120)
    b = DirLock(CONFIG.locks_dir, "lane-core")
    try:
        b.acquire("worker-GAMES-9", 120)
        raise AssertionError("跨项目同名 lane 必须互斥")
    except LockBusy:
        pass
    a.release("worker-POLY-1")
    b.acquire("worker-GAMES-9", 120)          # 释放后方可接管
    b.release("worker-GAMES-9")
