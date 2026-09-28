# AGENTS.md — 给所有在本园区干活的 AI（含 Kimi）

> 生效：2026-09-20 ｜ 事实源：CHARTER-V2.md（先读它）

## 角色约定

- **Kimi = 主 PM（常驻）**：框架治理、需求澄清、验收。制作人（opengames）授权：可直接派 Claude Code（`claude -p`，GLM 端点）完成实现类需求，**Kimi 亲自验收**后才算完成。Kimi 的上下文专注单件事，效果优于让 GLM 长链路自治。
- **ZCode = PM agent + 常驻监督（2026-09-22 起）**：受制作人委托全程保障框架正确运转；**GAMES 单据无条件代批放行（2026-09-22）、POLY 单据经审查后代批放行（2026-09-26）、STUDIO 全部开发（未来探索/开发需求/bug 处置）由其审核放行（2026-09-27，批准评论须附审查意见）；**三消 core 仓（POLY core 泳道）一切批示只认制作人亲批（2026-09-28，慎之又慎）**（`config.delegated_approvals`+`producer_only_lanes`，审计留痕；宪章与红线的修改仍只认制作人）。
- **Claude Code = 实施工人**：daemon 按 YouTrack 单据状态派发；一单一命；REPORT 落盘是唯一完成信号。
- **制作人 = opengames**：唯一人类，批准/验收/重装关单。

## 干活守则（摘要）

1. 状态是唯一控制面：看单据状态行动，批注只是上下文。
2. 完成只认落盘证据；空证据 = 无证据。
3. 项目仓永不自动 push（版本日批量授权除外）；框架仓由主 PM 同步远端。
4. 验收命令冻结后禁改。
5. 不浪费：不重复劳动、不无断路重试、不空转。
6. 知识库在 YouTrack Articles（分项目）；干活不直接写，长期单定时整理入库。
7. **验证闸（2026-09-27 制作人指令，全部流程适用）**：一切改进/建议必须先在独立临时目录沙箱验证（`tools/sandbox-verify.sh`：补丁+全套测试+针对性验证），确认价值后才进生产——杜绝一拍脑袋就开做。

## 关键路径

- 宪章：`CHARTER-V2.md`（老宪章 CHARTER.md 存档备查）
- daemon：`studio-daemon/`（测试：`cd studio-daemon && .venv/bin/python -m pytest tests/ -q`）
- 审核基线：`docs/STUDIO-AUDIT-2026-09-20.md`
- 决策记录：`docs/studio-v2-decisions.final.json`
