"""locks：mkdir 原子性语义/TTL 接管/owner 校验/beat——与 bash 版互操作的根基。"""
import sys, time
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from studio.locks import DirLock, LockBusy


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
