# 自优化体系（SELF-OPTIMIZE）— 框架持续进化的运作方式

> 生效：2026-09-26 ｜ 授权：制作人 opengames 2026-09-26 会话直接授权（"不断基于框架自优化，始终跟随前沿"）
> 本文是自优化程序的运作手册；宪章 CHARTER-V2.md 仍是上位法。

## 总纲

工作室不只是替业务干活，还把**自己**当成产品持续迭代。四根支柱：

1. **实验场**（安全试错）：生产仓之外克隆一份实验场，激进的改动先在实验场跑，
   验证后合并回生产。生产永不直接试未验证的设计。
2. **运营报告**（事实沉淀）：日报/周报/月报自动生成，全部来自落盘事实
   （events.jsonl / runs.jsonl / daemon 日志 / git log / 自评 digest），正文入知识库。
3. **前沿广域巡逻**（外部输入）：STUDIO-37 战役每 72h 扫全领域热点
   （GitHub trending / HN / 厂商动态 / 社区），逐个回答"对框架有何启发"，孵化提案子单。
4. **常驻监督**（ZCode 首席进化官）：每日巡查 triage + 每周前沿深扫，
   小毛病直接修（走纪律），大改造开提案单留制作人批。

## 实验场（Lab）

```bash
# 建（生产机上，目录随意；生产目录不动）
studio-daemon/tools/lab-init.sh /Volumes/BigDisk/Studio-Lab

# 冒烟（第一道闸：88+ 例全绿是底线）
cd /Volumes/BigDisk/Studio-Lab/studio-daemon && .venv/bin/python -m pytest tests/ -q

# 跑（第二道闸：实验 daemon 独立 kernel + 8788 面板 + 治理岗关闭）
cd studio-daemon && ./run-lab.sh

# 合并回生产（第三道闸：生产全量 pytest → commit → pkill 看护拉起）
git -C /Volumes/BigDisk/Studio fetch /Volumes/BigDisk/Studio-Lab
git -C /Volumes/BigDisk/Studio merge <分支>
cd /Volumes/BigDisk/Studio/studio-daemon && .venv/bin/python -m pytest tests/ -q
git -C /Volumes/BigDisk/Studio commit -a -m "..."
pkill -f "studio.daemon run"   # 看护脚本自动拉起新代码
```

隔离机制（环境变量，见 `studio/daemon.py` 头注）：
- `STUDIO_ROOT`：kernel 状态根（锁/证据/战役/日志/指标全部跟着走）
- `STUDIO_PORT`：面板端口（实验场 8788；Host 白名单自动跟随）
- `STUDIO_PROJECTS`：pm 岗项目域（留空=纯引擎/测试，不碰任何板面）
- `STUDIO_GOVERNANCE=0`：关闭 self-eval/patrol/evolve/报告——
  实验场与生产共用 YouTrack，治理岗不关会双写生产板

边界：YouTrack 实例与凭证是共享的（同一园区），但实验场默认不写任何生产项目。
沙箱板面项目（LAB）onboarding 尚未工具化，需要端到端派发实验时再立项。

## 运营报告（Reports）

- 岗哨：`report-daily`（每日 21:30）、`report-weekly`（周一 09:30）、`report-monthly`（1 日 09:40）
- 产出：`kernel/metrics/reports/daily-*.md` 等本地留底 + YouTrack STUDIO 知识库
  「运营日报 / 运营周报 / 运营月报」子树（`wiki_create` 幂等，重跑覆盖）
- 内容：指标（闸门失败率/QA 打回率/吞吐）+ 岗哨运行 + daemon ERROR 归并 +
  自评发现 + 战役巡逻进展 + 框架 git 变更 + **待决提案清单（制作人视角置顶）**
- 手动冒烟：`cd studio-daemon && .venv/bin/python -m studio.daemon tick report`

## 前沿广域巡逻（STUDIO-37）

- spec：`kernel/campaigns/STUDIO-37.yaml`（制作人随时可改）
- 每轮：WebFetch 巡逻源（GitHub trending / HN / 厂商博客 / 社区）→
  挑 3-5 个最热信号 → 逐个映射到框架改进面（派发/闸门/知识/自评/可观测/成本/多 agent 协作）
  → 可落地的开 **提案草稿单**（含链接+改造建议+预期收益）；噪音不开单
- 颠覆性思路（哪怕意味着大改框架）也欢迎进提案队列，由制作人定夺

## 提案治理流（改进如何落地）

```
来源（自评/巡逻/常驻监督/制作人点子）
  → STUDIO Type=提案 · 草稿          （不进派发流，等制作人）
  → 制作人择优：指令化（evolve-schema / kb-propose 评论）或直接口述给常驻监督
  → evolve-scan 应用（枚举+schema+git 留痕）→ 7 日观察窗 → 自动结案
  → 代码级改动：实验场验证 or 直接小修（pytest 全绿 → commit → pkill 拉起）
```

红线（不变）：框架仓由主 PM 同步远端；STUDIO 框架批示只认制作人；
一切变更 git 留痕；验证命令冻结后禁改。

## 已知欠账（下一步候选）

- `duration_ms` 全为 0 / `cost_cny`/`tokens` 未接线——成本效率类优化无从谈起
- YouTrack 沙箱项目（LAB）onboarding 未工具化（`studio onboard` 在 AGENTS 中
  被提及但未实现）
- STUDIO-23~32 九张 v2 规划期旧单挂在「新单」未清（等制作人定夺取消）
- STUDIO-36（QA 打回率 37%→25.6%）草稿未深挖——首张"自评→根因→修复→验证"样板单候选
