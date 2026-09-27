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
