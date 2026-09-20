"""STUDIO-13 一次性迁移：本地知识库 .md → YouTrack Articles（知识库唯一事实源）。

- 幂等：article 已存在则原地更新正文，可安全重跑
- 每篇正文追加溯源脚注（旧路径 + 单号），git 历史即审计记录
- 附带生成：全局/项目-仓库映射（YouTrack project ↔ git 仓库）、项目/ 层占位
- --check：迁移后复核（路径存在 + 正文逐字一致），退出码 0 = 全部通过

用法: cd studio-daemon && .venv/bin/python tools/kb_articles_migrate.py [--check]
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent        # studio-daemon/
STUDIO = ROOT.parent                                 # /Volumes/BigDisk/Studio

# (源文件相对 Studio 根, Articles 路径)
MANIFEST = [
    # ---- 全局层：机器级 AGENTS、公约、环境 ----
    ("kernel/TEAM.md", "全局/团队公约"),
    ("kernel/skills/AGENTS.md", "全局/AGENTS"),
    ("kernel/kb/global-agents-spec.md", "全局/AGENTS 规范"),
    ("kernel/kb/global-dev-env-toolchain.md", "全局/开发环境与工具链"),
    # ---- 编制层：角色档案 ----
    ("kernel/agents/pm.md", "编制/子PM"),
    ("kernel/agents/qa.md", "编制/全局QA"),
    ("kernel/agents/worker.md", "编制/worker"),
    ("kernel/agents/scout.md", "编制/Scout"),
    ("kernel/agents/inspector.md", "编制/Inspector"),
    # ---- 手册层：执行剧本 ----
    ("kernel/skills/worker-common.md", "手册/worker-common"),
    ("kernel/skills/sub-pm.md", "手册/sub-pm"),
    ("kernel/skills/dispatch.md", "手册/dispatch"),
    ("kernel/skills/qa-gate.md", "手册/qa-gate"),
    ("kernel/skills/digest.md", "手册/digest"),
    ("kernel/skills/inspector.md", "手册/inspector"),
    ("kernel/skills/scout.md", "手册/scout"),
    ("kernel/skills/version-day.md", "手册/version-day"),
    # ---- 框架层：studio-daemon 架构说明与路线图 ----
    ("kernel/kb/framework-daemon-architecture.md", "框架/studio-daemon 架构"),
    ("kernel/kb/framework-team-redlines.md", "框架/团队红线"),
    ("kernel/kb/framework-ticket-kb-guide.md", "框架/单子知识库指南"),
    ("kernel/kb/framework-agent-profiles.md", "框架/角色档案索引"),
    ("kernel/kb/framework-skills-index.md", "框架/手册索引"),
    ("kernel/kb/framework-deploy-ops.md", "框架/部署运维"),
    ("kernel/kb/framework-roadmap-decisions.md", "框架/路线图与决策"),
    ("studio-daemon/ROADMAP.md", "框架/路线图"),
]

STAMP = "2026-09-20"                                 # 迁移日（钉死：--check 任何一天重跑都可比对）


def _src_text(rel: str) -> str:
    """源文件正文：工作树优先；已删（迁移后）从 git 删除提交的父提交取快照。"""
    p = STUDIO / rel
    if p.exists():
        return p.read_text(encoding="utf-8")
    import subprocess
    r = subprocess.run(["git", "-C", str(STUDIO), "log", "-n", "1", "--format=%H",
                        "--diff-filter=D", "--", rel], capture_output=True, text=True)
    sha = r.stdout.strip().split("\n")[0] if r.stdout.strip() else ""
    if not sha:
        raise FileNotFoundError(f"{rel}（工作树与 git 历史均无）")
    return subprocess.run(["git", "-C", str(STUDIO), "show", f"{sha}^:{rel}"],
                          capture_output=True, text=True, check=True).stdout


def render(rel: str, text: str) -> str:
    # 不用 str.format：正文含 {字面量}（如 kernel/agents/{scout,inspector}.md）会被当占位符
    return (text.rstrip("\n") + "\n\n---\n\n> 迁移自 `" + rel + "`（STUDIO-13，" + STAMP +
            "）；本地文件已删除，后续演进直接改本 Article，git 历史即审计记录。\n")


def project_repo_map() -> str:
    import json
    lanes = json.loads((Path.home() / ".config/polymatch3/studio.json").read_text())["lanes"]
    ids = json.loads((STUDIO / "kernel/youtrack-ids.json").read_text())["projects"]
    rows = "\n".join(
        f"| {pid} | `{ids[pid]}` | `{lc['path']}` | {lc['base_branch']} |"
        for pid, lc in ((pid, lanes[name]) for pid, name in
                        (("POLY", "core"), ("POLY", "game"), ("STUDIO", "studio"))))
    return f"""# 项目-仓库映射（Git=开发层，YouTrack=流程+知识层）

一个 YouTrack project 对应一个或多个 git 仓库；单据流（派发/验收/状态机）在 YouTrack，
代码演进在 git 分支。workers 派发时按泳道路由到下表仓库。

| YouTrack 项目 | 项目 ID | git 仓库 | 基线分支 |
|---|---|---|---|
{rows}

> STUDIO-13 入册（{STAMP}）。lane↔仓库的机器可读配置：~/.config/polymatch3/studio.json。
"""


def project_stub() -> str:
    return f"""# 项目层知识库

双层架构的项目层：每个项目（PID）在 `项目/{{PID}}/` 下沉淀仓库约定、agent 分工、项目文档。
agent 工作中的过程发现（bug 修复过程/意外发现/来不及做的优化）以「草稿: 」开头挂入对应项目层，
PM 巡田收割转正。

> STUDIO-13 建层（{STAMP}）；各项目文档入驻时按 PID 建子节点。
"""


def main(argv: list[str]) -> int:
    sys.path.insert(0, str(ROOT))
    from studio.yt import YT
    t = YT("agent-pm")
    check = "--check" in argv
    if check:
        arts = t.wiki_all()
        bad = 0
        plan = [(rel, path, render(rel, _src_text(rel)))
                for rel, path in MANIFEST] + [
            ("~/.config/polymatch3/studio.json", "全局/项目-仓库映射", project_repo_map()),
            ("(generated)", "项目", project_stub())]
        for rel, path, want in plan:
            got = arts.get(path, {}).get("content")
            if got == want:
                print(f"OK       {path}")
            else:
                bad += 1
                print(f"MISMATCH {path} <- {rel}（存在={path in arts}）")
        print(f"\n{len(plan) - bad}/{len(plan)} 一致")
        return 1 if bad else 0
    n = 0
    for rel, path in MANIFEST:
        t.wiki_create(path, render(rel, _src_text(rel)))
        print(f"migrated {path} <- {rel}")
        n += 1
    t.wiki_create("全局/项目-仓库映射", project_repo_map())
    t.wiki_create("项目", project_stub())
    print(f"generated 全局/项目-仓库映射 / 项目")
    print(f"\n{n + 2} 篇写入完成；可跑 --check 复核")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
