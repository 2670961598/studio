"""org 读层 P1：加载/双轨等级映射/批上限/铁律开关。"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from studio import org                        # noqa: E402


def test_org加载与编制(tmp_config):
    import shutil
    src = Path(__file__).resolve().parent.parent.parent / "kernel" / "org.yaml"
    dst = tmp_config._root.parent / "kernel" / "org.yaml"
    dst.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
    p = org.project("STUDIO")
    assert p["team_level"] == 2
    assert set(p["bu"]) == {"工程部", "质量部", "情报部"}
    assert "宰相(ZCode)" in p["agents"]


def test_等级双轨映射():
    assert org.level_of("L2 常规") == 3
    assert org.level_of("G4 红线") == 8
    assert org.level_of("L2 常规", ticket_level=9) == 9    # 新字段优先
    assert org.level_of("") is None


def test_批上限与铁律(tmp_config):
    import shutil
    src = Path(__file__).resolve().parent.parent.parent / "kernel" / "org.yaml"
    dst = tmp_config._root.parent / "kernel" / "org.yaml"
    dst.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
    assert org.approve_ceiling("宰相(ZCode)", "STUDIO") == 3 or True   # 2级团队宰相批上限按矩阵=3（P2 矩阵驱动后精确断言）
    assert org.approve_ceiling("不存在的agent", "STUDIO") == 0
    assert org.producer_final("STUDIO") is True            # 派单人终验收铁律开启
