"""import 冒烟：套件曾漏 import studio.daemon，坏括号提交后靠看护拉起失败才暴露
（生产停摆 10 分钟，2026-09-27 实录）——每个模块都必须能被 import。"""
import importlib, pkgutil, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import studio                                            # noqa: E402


def test_全模块可导入():
    """studio 包下所有模块 import 一遍——语法错误/循环导入当场炸。"""
    import studio.daemon                                 # 主入口最关键（曾被漏）
    for m in pkgutil.iter_modules(studio.__path__):
        if not m.name.startswith("_"):
            importlib.import_module(f"studio.{m.name}")


def test_sched装配冒烟(tmp_config):
    """触发器错误（如 from_crontab 6 字段）只在装配时炸——import 冒烟抓不到，
    曾致生产启动循环崩溃（2026-09-28 实录）。装配必须进冒烟。"""
    import studio.daemon as d
    from studio import runtime
    prev = runtime.SCHED                      # _sched 会写全局态——测试后还原防污染后续用例
    try:
        s = d._sched()
        ids = sorted(j.id for j in s.get_jobs())
        assert {"pm-poly", "pm-studio", "pm-games", "drain-watch",
                "report-daily", "report-weekly", "report-monthly"} <= set(ids)
    finally:
        runtime.SCHED = prev
