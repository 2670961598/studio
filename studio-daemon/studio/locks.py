"""locks — 目录锁原生实现（与 ~/bin/studio-lock 完全互操作：同一锁目录、同一语义）
mkdir 原子获取；过期锁 rmtree 后接管（对齐 bash 版）；release 校验 owner 防误删他人锁；
长任务 beat 续期。（P0-1/P1-5 修复：过期接管不再抛 FileExistsError）"""
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
        """有效锁返回 (owner, age)，过期/不存在返回 None。"""
        if not self.path.is_dir() or self._age_min() >= ttl_min:
            return None
        try:
            owner = self.path.joinpath("owner").read_text().strip()
        except FileNotFoundError:
            owner = "?"
        return owner, self._age_min()

    def _take(self, owner: str):
        self.path.joinpath("owner").write_text(owner)
        self.path.joinpath("pid").write_text(str(os.getpid()))
        self.path.joinpath("ts").write_text(str(int(time.time())))
        self.owner, self.held = owner, True

    def acquire(self, owner: str, ttl_min: int = 120) -> None:
        for _ in range(3):                       # 过期接管重试（并发败者各清各的）
            cur = self._read(ttl_min)
            if cur:
                raise LockBusy(f"{cur[0]} {cur[1]}min")
            try:
                self.path.mkdir(parents=True)
                self._take(owner)
                return
            except FileExistsError:
                cur = self._read(ttl_min)        # 复查：真并发 → HELD；过期 → 清尸重试
                if cur:
                    raise LockBusy(f"{cur[0]} {cur[1]}min")
                shutil.rmtree(self.path, ignore_errors=True)
        raise LockBusy("takeover-race")

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
            cur = None
            try:
                cur = self.path.joinpath("owner").read_text().strip()
            except FileNotFoundError:
                cur = "?"
            # 只放自己的锁：显式 owner 或本实例持有；他人锁拒绝（防 TTL 接管后误删）
            if owner and cur != owner:
                raise PermissionError(f"DENIED owner={cur}")
            if not owner and not self.held:
                raise PermissionError(f"DENIED owner={cur}（非本实例所持，需传 owner）")
            shutil.rmtree(self.path, ignore_errors=True)
        self.held = False
        return "RELEASED"


def lock(cfg, name: str) -> DirLock:
    return DirLock(cfg.locks_dir, name)
