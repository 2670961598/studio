"""locks — 目录锁原生实现（与 ~/bin/studio-lock 完全互操作：同一锁目录、同一语义）
mkdir 原子获取；存活 = ts 新鲜度(TTL) + 显式 release；长任务 beat 续期。"""
import os, shutil, time
from pathlib import Path


class LockBusy(Exception):
    pass


class DirLock:
    def __init__(self, locks_dir: Path, name: str):
        self.path = Path(locks_dir) / f"{name}.lock"
        self.owner = ""
        self.held = False

    def _age_min(self) -> int:
        try:
            return int((time.time() - self.path.joinpath("ts").stat().st_mtime) // 60)
        except FileNotFoundError:
            return 1 << 30

    def _read(self, ttl_min: int):
        if not self.path.is_dir() or self._age_min() >= ttl_min:
            return None
        try:
            owner = self.path.joinpath("owner").read_text().strip()
        except FileNotFoundError:
            owner = "?"
        return owner, self._age_min()

    def acquire(self, owner: str, ttl_min: int = 120) -> None:
        cur = self._read(ttl_min)
        if cur:
            raise LockBusy(f"{cur[0]} {cur[1]}min")
        try:
            self.path.mkdir(parents=True)
        except FileExistsError:
            cur = self._read(ttl_min)  # 并发败者复查一次
            if cur:
                raise LockBusy(f"{cur[0]} {cur[1]}min")
            self.path.mkdir(parents=True)
        self.path.joinpath("owner").write_text(owner)
        self.path.joinpath("pid").write_text(str(os.getpid()))
        self.path.joinpath("ts").write_text(str(int(time.time())))
        self.owner, self.held = owner, True

    def check(self, ttl_min: int = 120):
        cur = self._read(ttl_min)
        return f"HELD {cur[0]} {cur[1]}min" if cur else "FREE"

    def beat(self):
        if self.held:
            self.path.joinpath("ts").write_text(str(int(time.time())))
            return "BEAT"
        return "NOT-HELD"

    def release(self, owner: str | None = None):
        if self.path.is_dir():
            if owner:
                try:
                    cur = self.path.joinpath("owner").read_text().strip()
                except FileNotFoundError:
                    cur = "?"
                if cur != owner:
                    raise PermissionError(f"DENIED owner={cur}")
            shutil.rmtree(self.path)
        self.held = False
        return "RELEASED"


def lock(cfg, name: str) -> DirLock:
    return DirLock(cfg.locks_dir, name)
