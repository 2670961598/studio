"""statemachine v2：级别流展开/位置语义/退回/取消/旧值映射——schema 驱动的回归网。"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from studio import statemachine as sm


class TestDeliveryFlows:
    def test_l0_无审批直通(self):
        assert sm.allowed("新单", "已派发", "L0 自动", "需求")
        assert sm.allowed("复验通过", "已交付", "L0 自动", "需求")
        assert not sm.allowed("新单", "待批", "L0 自动", "需求")

    def test_l2_两批(self):
        assert sm.allowed("新单", "待批", "L2 常规", "需求")
        assert sm.allowed("待批", "已派发", "L2 常规", "需求")
        assert sm.allowed("复验通过", "待批", "L2 常规", "需求")
        assert sm.allowed("待批", "已交付", "L2 常规", "需求")

    def test_l3_两段派发同名态(self):
        assert sm.allowed("证据就绪", "待批", "L3 特护", "需求")      # 方案审
        assert sm.allowed("待批", "已派发", "L3 特护", "需求")        # 重派实现
        assert sm.allowed("证据就绪", "复验通过", "L3 特护", "需求")
        assert not sm.allowed("新单", "已派发", "L3 特护", "需求")     # 必须先批

    def test_跳态禁止(self):
        assert not sm.allowed("新单", "证据就绪", "L2 常规", "需求")
        assert not sm.allowed("已派发", "已交付", "L2 常规", "需求")
        assert not sm.allowed("待批", "复验通过", "L2 常规", "需求")

    def test_退回边(self):
        assert sm.allowed("证据就绪", "已派发", "L2 常规", "需求")
        assert sm.allowed("复验通过", "已派发", "L1 首批", "需求")


class TestSpecialEdges:
    def test_战役(self):
        assert sm.allowed("新单", "运行中", None, "战役")
        assert sm.allowed("运行中", "暂停", None, "战役")
        assert sm.allowed("暂停", "运行中", None, "战役")
        assert not sm.allowed("运行中", "已关闭", None, "战役")

    def test_提案治理流(self):
        assert sm.allowed("草稿", "待批", "G2 类型", "提案")
        assert sm.allowed("待批", "实施中", "G2 类型", "提案")
        assert sm.allowed("实施中", "观察窗", "G1 知识", "提案")
        assert sm.allowed("观察窗", "结案", "G1 知识", "提案")

    def test_疑问与情报(self):
        assert sm.allowed("新单", "待答", None, "疑问")
        assert sm.allowed("发现", "评估中", None, "情报")


class TestCancelAndLevels:
    def test_取消几乎处处可(self):
        for frm in ("新单", "待批", "已派发", "运行中", "草稿"):
            assert sm.allowed(frm, "已取消", None, "战役") or sm.allowed(frm, "已取消", "L2 常规", "需求")

    def test_终态不可取消(self):
        for frm in ("已交付", "已关闭", "已归档", "结案", "已取消"):
            assert not sm.allowed(frm, "已取消", "L2 常规", "需求")
            assert not sm.allowed(frm, "已取消", None, "战役")

    def test_旧轨道值映射(self):
        assert sm._norm_level("A 特护") == "L3 特护"
        assert sm._norm_level("B 常规") == "L2 常规"
        assert sm._norm_level("C 轻轨") == "L0 自动"
        assert sm._norm_level("-") == "L2 常规"          # 历史单缺省
        assert sm._norm_level(None) == "L2 常规"


class TestNextStates:
    def test_next_states_含退回(self):
        ns = sm.next_states("证据就绪", "L2 常规", "需求")
        assert "复验通过" in ns and "已派发" in ns

    def test_next_states_战役(self):
        assert set(sm.next_states("运行中", None, "战役")) == {"暂停"}


class Test草稿转正双断链修复:
    """旧审计 C1/C2（宪章 §10 点名消化未兑现）：技术债/情报草稿 promote 必炸
    "非法迁移"——yaml 双 情报: 键静默覆盖丢 [草稿,发现] 边 + 交付族永不查 type_edges。"""

    def test_技术债草稿promote合法(self):
        import studio.statemachine as sm
        assert sm.allowed("草稿", "新单", "L1 首批", "技术债") is True

    def test_情报草稿promote合法(self):
        import studio.statemachine as sm
        assert sm.allowed("草稿", "发现", None, "情报") is True
        assert sm.allowed("发现", "评估中", None, "情报") is True

    def test_交付族补查不破坏级别流语义(self):
        import studio.statemachine as sm
        # 级别流非法迁移依然拒（补查只开 type_edges 里声明的边）
        assert sm.allowed("新单", "已交付", "L2 常规", "需求") is False
        assert sm.allowed("草稿", "新单", "L2 常规", "需求") is False   # 需求无 type_edges

    def test_重复键schema拒载回退内置(self, tmp_config, monkeypatch):
        import studio.statemachine as sm
        bad = tmp_config._root.parent / "kernel" / "schema" / "ticket-types.yaml"
        orig = bad.read_text(encoding="utf-8")
        monkeypatch.setattr(sm, "SCHEMA_PATH", bad)
        bad.write_text(orig + "\n情报: [[发现, 评估中]]\n", encoding="utf-8")
        sm.recompute()
        # 回退内置表（BUILTIN_TYPE_EDGES 完整含 情报 三边），不是被覆盖的残缺表
        assert sm.allowed("草稿", "发现", None, "情报") is True
        bad.write_text(orig, encoding="utf-8")
        sm.recompute()
