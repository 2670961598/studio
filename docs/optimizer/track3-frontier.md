# 轨 3 · 前沿搜索与对比（追加式轨道文件）

> 守护程序见 docs/88-自优化守护程序.md。对比基线=docs/49 竞争定位 doctrine（代理权网状）。

## 2026-10-31 R1（DeepSeek 搜索端点核实 + 首批前沿数据）

**通道核实（制作人令指向）**：DeepSeek **官方 Search & Fetch API 存在且已接入**——
端点 `https://api.deepseek.com/v1/tools/{search,fetch}`（[官方指南](https://api-docs.deepseek.com/guides/search)、
[API 参考](https://api-docs.deepseek.com/api/search)、[中文指南](https://api-docs.deepseek.com/zh-cn/guides/search)）。
worker 侧经 dsh 插件对已通（轨 4 R1）；宰相侧经自带 WebSearch 兜底。**tri-通道**：工人插件 /
宰相 WebSearch / 直接 REST（key 在案）。

**首批前沿数据（首搜即中）**：
- DeepSeek 2026-10-17 动态：V4.1-Flash 升级 **V4.1-Flash-1017**（基准提升、耗时/输出缩短、
  API 名与价不变——`deepseek-flash` 即用）；同日开放自研搜索引擎的 Search/Fetch API。
  来源：[官方更新日志](https://api-docs.deepseek.com/updates)｜[ZOL 报道](https://ai.zol.com.cn/1265/12659178.html)
  → **行动项**：模型档映射无需改（`deepseek-flash` 别名已覆盖）；价目表快照核对一次。
- 待下轮展开：todos.dev/Claude Code/Codex/OpenAI Handoffs/LangGraph/AutoGen/CrewAI 对比矩阵。

**对比纪要方法（冻结）**：每项=「前沿做法 → StudioNext 现状 → 吸收/差异化判定 → 可立单
改进项」；来源逐条给链；吸收判不准的标 doctrine 级呈制作人。
