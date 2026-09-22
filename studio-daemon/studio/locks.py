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
        # 自校验：并发双胜者时，读回 owner 不一致的一方视为丢锁（防双持窗口）
        try:
            if self.path.joinpath("owner").read_text().strip() != owner:
                raise LockBusy("lost-takeover-race")
        except FileNotFoundError:
            raise LockBusy("lost-takeover-race")
        self.owner, self.held = owner, True

    def acquire(self, owner: str, ttl_min: int = 120) -> None:
        for _ in range(3):                       # 过期接管重试（并发败者各清各的）
            cur = self._read(ttl_min)
            if cur and not self._owner_dead():
                raise LockBusy(f"{cur[0]} {cur[1]}min")
            if cur:                              # 持锁进程已死：清尸接管（不留 TTL 盲窗）
                shutil.rmtree(self.path, ignore_errors=True)
            try:
                self.path.mkdir(parents=True)
                self._take(owner)
                return
            except FileExistsError:
                cur = self._read(ttl_min)        # 复查：真并发 → HELD；过期 → 清尸重试
                if cur and not self._owner_dead():
                    raise LockBusy(f"{cur[0]} {cur[1]}min")
                shutil.rmtree(self.path, ignore_errors=True)
        raise LockBusy("takeover-race")

    def _owner_dead(self) -> bool:
        """锁上记录的 pid 已不存在 = 死进程残留（daemon 被 kill -9/崩溃等）。
        tick 锁 TTL 240min：无此接管则一次崩溃 = 4 小时盲窗（09-22 实录）。"""
        try:
            pid = int(self.path.joinpath("pid").read_text().strip())
        except (FileNotFoundError, ValueError):
            return False                          # 无 pid 可考 → 保守按活锁处理
        try:
            os.kill(pid, 0)
            return False
        except ProcessLookupError:
            return True
        except PermissionError:
            return False                          # 别人的进程（活着但无权探测）

    def check(self, ttl_min: int = 120):
        cur = self._read(ttl_min)
        return f"HELD {cur[0]} {cur[1]}min" if cur else "FREE"

    def beat(self, owner: str | None = None):
        """续期：按盘上 owner 校验（修复 held 标志在跨实例场景失效的死代码问题）。"""
        owner = owner or self.owner
        try:
            cur = self.path.joinpath("owner").read_text().strip()
        except FileNotFoundError:
            return "NOT-HELD"
        if cur != owner:
            return "DENIED"
        self.path.joinpath("ts").write_text(str(int(time.time())))
        self.held = True
        self.owner = owner
        return "BEAT"

    def release(self, owner: str | None = None):
        if self.path.is_dir():
            cur = None
            try:
                cur = self.path.joinpath("owner").read_text().strip()
            except FileNotFoundError:
                cur = "?"
            # 只放自己的锁：显式 owner 或盘上 owner 与本实例一致；他人/被接管的锁拒绝
            if owner and cur != owner:
                raise PermissionError(f"DENIED owner={cur}")
            if not owner and (not self.held or cur != self.owner):
                raise PermissionError(f"DENIED owner={cur}（非本实例所持，需传 owner）")
            shutil.rmtree(self.path, ignore_errors=True)
        self.held = False
        return "RELEASED"


def lock(cfg, name: str) -> DirLock:
    return DirLock(cfg.locks_dir, name)
