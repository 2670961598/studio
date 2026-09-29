"""orggov — org.yaml team_level 变更治理（STUDIO-55 升级流程代码化，CHARTER-V3 §12.6）。
链路（宪章 §12.6）：项目最高负责人提议 → 最高领导层会签 → 制作人终验收 → 升级。
载体：Type=提案 单的评论指令（evolve 同族第四指令；状态流沿用提案族 草稿→待批→实施中→观察窗）：
  org-upgrade <新等级> <理由>   负责人提议（org.yaml projects.<pid>.leader；制作人亦可，§4.4 任意介入）
  cosign / 会签                 领导层成员（leader + 各 bu 主管）会签
  approve                       制作人终验（必须在会签齐之后——终验=链路最后一环）
门槛：会签 min(3, 领导层人数)（宪章「≥3级团队三人签」；approvals.升级会签数 可覆盖，帽=领导层人数）；
      提议人署名提议即计入会签（三人签含提议人——否则小团队天然死锁）。
身份：署名协议 [项目·个体名·部门]（§12.4 账号=等级锚点，个体靠署名）；无署名回落 author login，
      org.yaml agents 的 login 字段作个体名别名。
安全：无制作人 approve 绝不应用；新提议自动作废旧链（会签/终验必须晚于最后一次提议）；
      等级必须 1-9 且 ≠ 现值；应用 = 保注释改写 org.yaml + 写前写后机器断言 + git 留痕 + 事件记账。"""
import re, subprocess, time, yaml
from dataclasses import dataclass
from pathlib import Path
from .config import CONFIG

MARK_PENDING, MARK_REJECT, MARK_APPLIED = "ORG-UPGRADE-PENDING", "ORG-UPGRADE-REJECT", "ORG-UPGRADE-APPLIED"
COSIGN_WORDS = {"cosign", "会签"}


@dataclass
class Chain:
    stage: str          # idle | invalid | pending-cosign | pending-producer | ready | applied
    target: int | None
    detail: str
    cosigned: int = 0
    need: int = 0


def _org_yaml() -> Path:
    """调用期解析（org.ORG_PATH 是 import 期常量，测试换 _root 后指不对）。"""
    return CONFIG._root.parent / "kernel" / "org.yaml"


def _load_all() -> dict:
    try:
        return yaml.safe_load(_org_yaml().read_text(encoding="utf-8")) or {}
    except Exception as e:
        print(f"[orggov] org.yaml 读取失败: {type(e).__name__} {e}")
        return {}


def leadership(pdata: dict) -> list[str]:
    """最高领导层 = leader + 各 bu 主管（去重，个体名）。"""
    names = []
    ld = (pdata.get("leader") or {}).get("name")
    if ld:
        names.append(ld)
    for b in (pdata.get("bu") or {}).values():
        h = (b or {}).get("主管")
        if h and h not in names:
            names.append(h)
    return names


def cosign_need(pdata: dict) -> int:
    """会签门槛：默认 min(3, 领导层人数)（≥3级团队三人签；更小团队按人头封顶防死锁），
    approvals.升级会签数 可覆盖；帽=领导层人数，下限 1（提议人）。"""
    cap = len(leadership(pdata))
    n = (pdata.get("approvals") or {}).get("升级会签数")
    try:
        n = int(n) if n is not None else min(3, cap)
    except (TypeError, ValueError):
        n = min(3, cap)
    return max(1, min(n, cap))


def _sig_ident(text: str, author: str) -> str:
    """评论身份：署名协议 [项目·个体名·部门] 优先；无署名回落 author login。"""
    t = (text or "").strip()
    if t.startswith("[") and "]" in t:
        parts = t[1:t.index("]")].split("·")
        if len(parts) >= 2 and parts[1].strip():
            return parts[1].strip()
    return author


def _body(text: str) -> str:
    """去署名前缀后的指令正文。"""
    t = (text or "").strip()
    if t.startswith("[") and "]" in t:
        return t[t.index("]") + 1:].strip()
    return t


def _match_leader(ident: str, author: str, pdata: dict) -> str | None:
    """身份（署名个体名或账号）→ 领导层成员名；不在领导层返回 None。"""
    agents = pdata.get("agents") or {}
    for name in leadership(pdata):
        toks = {name}
        lg = (agents.get(name) or {}).get("login")
        if lg:
            toks.add(lg)
        if ident in toks or author in toks:
            return name
    return None


def evaluate(pdata: dict, comments: list[dict], producer: str) -> Chain:
    """升级链裁决（纯函数）：org 项目段 + 评论流（author/text/created，时间序不假设）→ 链态。"""
    cur = int(pdata.get("team_level") or 0)
    cs = sorted(comments, key=lambda c: (c.get("created") or 0))
    # 最后一次有效提议（负责人署名或制作人亲提）；重提自动作废旧链——只认最后一条
    prop = None
    for c in cs:
        if (_body(c.get("text") or "").split() or [""])[0] != "org-upgrade":
            continue
        ident = _sig_ident(c.get("text") or "", c.get("author") or "")
        if c.get("author") == producer or _match_leader(ident, c.get("author") or "", pdata):
            prop = c
    if prop is None:
        return Chain("idle", None, "无负责人提议")
    proposed_at = prop.get("created") or 0
    toks = _body(prop.get("text") or "").split()
    try:
        target = int(toks[1])
    except (IndexError, ValueError):
        return Chain("invalid", None, "org-upgrade 缺等级参数（用法：org-upgrade <1-9> <理由>）")
    if not 1 <= target <= 9:
        return Chain("invalid", target, f"等级 {target} 越界（须 1-9）")
    if any((c.get("text") or "").strip().startswith(MARK_APPLIED)
           and (c.get("created") or 0) >= proposed_at for c in cs):
        return Chain("applied", target, "已应用（幂等）")   # 先于现状比对：已应用解释了 cur==target
    if target == cur:
        return Chain("invalid", target, f"等级 {target} = 现状，无事可做")
    # 会签：领导层成员在提议之后的 cosign；提议人署名提议即计入
    need = cosign_need(pdata)
    signed: dict[str, int] = {}
    for c in cs:
        if (c.get("created") or 0) <= proposed_at:
            continue
        if (_body(c.get("text") or "").split() or [""])[0] not in COSIGN_WORDS:
            continue
        ident = _sig_ident(c.get("text") or "", c.get("author") or "")
        name = _match_leader(ident, c.get("author") or "", pdata)
        if name and name not in signed:
            signed[name] = c.get("created") or 0
    pname = _match_leader(_sig_ident(prop.get("text") or "", prop.get("author") or ""),
                          prop.get("author") or "", pdata)
    if pname and pname not in signed:
        signed[pname] = proposed_at
    if len(signed) < need:
        lacking = [n for n in leadership(pdata) if n not in signed]
        return Chain("pending-cosign", target,
                     f"会签 {len(signed)}/{need}，待签：{'、'.join(lacking)}", len(signed), need)
    quorum_at = sorted(signed.values())[need - 1]        # 第 need 签落笔时刻=会签齐
    final_ok = any(c.get("author") == producer
                   and (_body(c.get("text") or "").split() or [""])[0] == "approve"
                   and (c.get("created") or 0) >= quorum_at for c in cs)
    if not final_ok:
        return Chain("pending-producer", target, "待制作人终验（approve 须在会签齐之后）",
                     len(signed), need)
    return Chain("ready", target, "链路完整：负责人提议→领导层会签→制作人终验", len(signed), need)


def rewrite_team_level(text: str, pid: str, new: int) -> str:
    """保注释改写 projects.<pid>.team_level（org.yaml 满篇人读注释，yaml round-trip 会抹掉）。"""
    lines = text.splitlines()
    key = re.compile(rf"^(\s+){re.escape(pid)}:\s*(#.*)?$")
    for i, ln in enumerate(lines):
        m = key.match(ln)
        if not m:
            continue
        ind = len(m.group(1))
        for j in range(i + 1, len(lines)):
            raw = lines[j]
            if not raw.strip() or raw.lstrip().startswith("#"):
                continue
            if len(raw) - len(raw.lstrip()) <= ind:
                break                                   # 出了项目块
            if re.match(r"^(\s+)team_level:\s*\d+\s*(#.*)?$", raw):
                lines[j] = re.sub(r"team_level:\s*\d+", f"team_level: {new}", raw, count=1)
                return "\n".join(lines) + ("\n" if text.endswith("\n") else "")
        raise ValueError(f"{pid} 项目块内未找到 team_level 行")
    raise ValueError(f"org.yaml 未找到项目 {pid}")


def apply_level(pid: str, new: int) -> int:
    """应用升级：保注释改写 + 写前写后机器断言；返回旧等级（空证据=无证据的反面：断言失败即炸）。"""
    p = _org_yaml()
    old_text = p.read_text(encoding="utf-8")
    pdata = (yaml.safe_load(old_text) or {}).get("projects", {}).get(pid) or {}
    old = int(pdata.get("team_level") or 0)
    if not old:
        raise ValueError(f"{pid} 缺 team_level，拒绝盲写")
    new_text = rewrite_team_level(old_text, pid, new)
    chk = (yaml.safe_load(new_text) or {}).get("projects", {}).get(pid, {})
    if int(chk.get("team_level") or 0) != new:          # 写前断言：解析层即达目标
        raise ValueError("改写后解析结果未达目标，拒绝落盘")
    p.write_text(new_text, encoding="utf-8")
    back = (yaml.safe_load(p.read_text(encoding="utf-8")) or {}).get("projects", {}).get(pid, {})
    if int(back.get("team_level") or 0) != new:         # 写后断言：盘上即目标
        raise RuntimeError("写后复核失败（盘上等级≠目标）")
    return old


def _yt():
    from .yt import YT
    return YT("agent-8")


def _log(line: str):
    p = CONFIG.logs_dir / f"daemon-{time.strftime('%F')}.log"
    with open(p, "a", encoding="utf-8") as f:
        f.write(f"{time.strftime('%F %T')} [orggov] {line}\n")


def _hinted(cs, marker: str, fingerprint: str) -> bool:
    return any((c.get("text") or "").strip().startswith(marker) and fingerprint in (c.get("text") or "")
               for c in cs)


def _process(yt, pid: str, iid: str) -> str | None:
    pdata = ((_load_all().get("projects") or {}).get(pid)) or {}
    if not pdata:
        return None
    cs = yt.comments(iid)
    ch = evaluate(pdata, cs, CONFIG.producer)
    if ch.stage == "idle":
        return None
    if ch.stage == "invalid":
        if not _hinted(cs, MARK_REJECT, ch.detail[:20]):
            yt.comment(iid, f"{MARK_REJECT} {ch.detail}。请负责人 "
                            f"{(pdata.get('leader') or {}).get('name') or '?'} 重发："
                            "org-upgrade <1-9> <理由>。")
        return f"INVALID {iid}"
    if ch.stage == "applied":
        return None
    cur = int(pdata.get("team_level") or 0)
    try:                                                # 单据推进对齐提案族（guard 尽力而为不强求）
        if "G" not in (yt.f(iid, "轨道") or ""):
            yt.set_field(iid, "轨道", "G3 编制")
        if yt.f(iid, "State") == "草稿":
            yt.transition(iid, "待批")
    except Exception as e:
        _log(f"WARN pending {iid} {e}")
    if ch.stage in ("pending-cosign", "pending-producer"):
        fp = f"{ch.cosigned}/{ch.need}"
        if not _hinted(cs, MARK_PENDING, fp):           # 进度变化才提示（会签只增，天然有界）
            yt.comment(iid, f"{MARK_PENDING} {pid} {cur}→{ch.target}（{ch.detail}）。\n"
                            f"链路：负责人提议 → 领导层会签 cosign（{ch.need} 人）→ "
                            "制作人终验 approve（须在会签齐后）。")
        return f"{ch.stage.upper()} {iid}"
    old = apply_level(pid, ch.target)
    subprocess.run(["git", "-C", str(CONFIG._root.parent), "add", "-A"], check=False)
    subprocess.run(["git", "-C", str(CONFIG._root.parent), "commit", "-q", "-m",
                    f"org-upgrade: {pid} {old}→{ch.target}（{iid} 升级流程走完：提议→会签→制作人终验）"],
                   check=False)
    from .metrics import append_event
    append_event(pid, iid, "ORG_UPGRADE", "agent-8", 0, f"{pid} team_level {old}→{ch.target}")
    try:
        from . import org
        org.load(force=True)                            # 生产路径热刷新 org 缓存
    except Exception:
        pass
    yt.comment(iid, f"{MARK_APPLIED} {pid} {old}→{ch.target}：负责人提议→领导层会签 "
                    f"{ch.cosigned}/{ch.need}→制作人终验；org.yaml 保注释改写+写后断言+git 留痕。")
    try:
        if yt.f(iid, "State") == "待批":
            yt.transition(iid, "实施中")
        yt.transition(iid, "观察窗")                     # 7 天观察窗由 evolve.close_windows 收割
    except ValueError as e:
        _log(f"WARN window {iid} {e}")
    return f"APPLIED {iid} {pid} {old}→{ch.target}"


def scan(yt=None) -> list[str]:
    """扫升级提案（Type=提案 草稿/待批）：链路完整即应用——team_level 变更唯一机械入口。
    加锁防重入（cron 与面板手动触发可并发）；干完即放（evolve.scan 只取不放，
    实测退化为 5h 一跑——不复刻，见 REPORT）。"""
    from .locks import lock, LockBusy
    lk = lock(CONFIG, "orggov-scan")
    try:
        lk.acquire("orggov-scan", 300)
    except LockBusy:
        return []
    try:
        yt = yt or _yt()
        actions = []
        for pid in (_load_all().get("projects") or {}):
            try:
                tickets = yt.list(pid, "Type:提案 状态:草稿,待批")
            except Exception as e:
                _log(f"ERROR list {pid} {e}")
                continue
            for row in tickets:
                iid = row["id"]
                try:
                    a = _process(yt, pid, iid)
                except Exception as e:
                    _log(f"ERROR {iid} {e}")
                    a = None
                if a:
                    actions.append(a)
        return actions
    finally:
        lk.release()
