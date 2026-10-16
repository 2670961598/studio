"""daemon — 入口：APScheduler 装配 + uvicorn 仪表盘
用法:
  python -m studio.daemon run          # 常驻（launchd KeepAlive 拉起）
  python -m studio.daemon tick pm|selfeval|report|steward|gamesdaily|polydaily|pmdaily  # 手动跑一岗（调试/冒烟）
  python -m studio.daemon board        # 打印板面快照
环境隔离（实验场）：
  STUDIO_ROOT=<dir>   换 kernel 状态根（锁定/证据/战役/日志全部跟着走）
  STUDIO_PORT=<port>  换面板端口（默认 8787，实验场用 8788）
  STUDIO_PROJECTS=A,B 只给这些项目装 pm 岗（默认全部；实验场填沙箱项目）
  STUDIO_GOVERNANCE=0 关闭治理族岗（self-eval/patrol/evolve/报告）——
                      实验场与生产共用 YouTrack，治理岗必须关，防双写生产板
错峰表照宪章 §4：pm 0 分位、qa 7 分位；max_instances=1 防自身重叠。"""
import os, sys, threading, time

# pm 岗错峰分位（历史约定：POLY 0 分位、STUDIO 4、GAMES 7；新项目顺延错峰）
# GAMES 提频 10→5min（制作人 2026-10-16 指令"更加快速推进"）：链内转换（派发/收割/复验/
# 合并）每跳省至多 5min，×8 单链 ≈30-40min/款；tick 自身有 tick 锁幂等，门禁执行期
# （4-5min）撞拍自动顺延不重入。
_PM_MINUTES = {"POLY": "0,10,20,30,40,50", "STUDIO": "4,14,24,34,44,54",
               "GAMES": "2,7,12,17,22,27,32,37,42,47,52,57",
               "SNEXT": "6,16,26,36,46,56"}


def _scoped_projects() -> list[str]:
    """STUDIO_PROJECTS 过滤：显式声明但项目不在 ids 里 → 空（宁缺勿滥：
    实验场写错项目名也不能滑回全量跑生产板）。"""
    from .config import CONFIG
    want = os.environ.get("STUDIO_PROJECTS", "").strip()
    if not want:
        return list(CONFIG.projects)
    return [p for p in CONFIG.projects if p in want.split(",")]



def _sched():
    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.triggers.cron import CronTrigger
    from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
    from apscheduler import events as apev
    from .config import CONFIG
    from .runs import append_run, seed_from_logs, DurationTracker
    seed_from_logs()
    sched = BackgroundScheduler(
        jobstores={"default": SQLAlchemyJobStore(
            url=f"sqlite:///{CONFIG._root / 'jobs.sqlite'}")},
        job_defaults={"max_instances": 1, "coalesce": True, "misfire_grace_time": 300})
    tracker = DurationTracker()      # 宪章 §4.6：duration_ms 必须接线（审计 P0-1 断点A）

    def _on_event(ev):
        job = getattr(ev, "job_id", "?")
        if ev.code == apev.EVENT_JOB_SUBMITTED:
            tracker.submitted(job)
        elif ev.code == apev.EVENT_JOB_MISSED:
            tracker.drop(job)
            append_run(job, "missed", 0, "错过调度（宿主忙/睡眠）")
        elif ev.code == apev.EVENT_JOB_ERROR:
            exc = getattr(ev, "exception", None)
            append_run(job, "error", tracker.settle(job),
                       f"{type(exc).__name__}: {exc}"[:200] if exc else "error")
        elif ev.code == apev.EVENT_JOB_EXECUTED:
            dur = tracker.settle(job)
            r = getattr(ev, "retval", None)
            if isinstance(r, dict):
                summary = "; ".join(r.get("actions", []))[:200] or r.get("result", "")
                outcome = "ok" if r.get("result") in ("OK", "IDLE") else str(r.get("result", "ok")).lower()
                append_run(job, outcome, dur, summary)
            else:
                append_run(job, "ok", dur, str(r)[:200])

    sched.add_listener(_on_event,
                       apev.EVENT_JOB_EXECUTED | apev.EVENT_JOB_ERROR | apev.EVENT_JOB_MISSED
                       | apev.EVENT_JOB_SUBMITTED)
    # 文本引用保证 job 可序列化进 SQLite jobstore
    for i, pid in enumerate(_scoped_projects()):
        minutes = _PM_MINUTES.get(pid) or ",".join(
            str((11 + 3 * i + 10 * k) % 60) for k in range(6))
        sched.add_job("studio.orchestrator:pm_tick",
                      CronTrigger.from_crontab(f"{minutes} * * * *"),
                      kwargs={"pid": pid}, id=f"pm-{pid.lower()}",
                      replace_existing=True)
    if os.environ.get("STUDIO_GOVERNANCE", "1") == "1":
        sched.add_job("studio.metrics:self_eval", CronTrigger.from_crontab("50 8 * * *"),
                      id="self-eval", replace_existing=True)
        sched.add_job("studio.patrol:patrol_tick", CronTrigger.from_crontab("5 * * * *"),
                      id="patrol", replace_existing=True)
        sched.add_job("studio.evolve:scan", CronTrigger.from_crontab("3,13,23,33,43,53 * * * *"),
                      id="evolve-scan", replace_existing=True)
        sched.add_job("studio.orggov:scan", CronTrigger.from_crontab("7,17,27,37,47,57 * * * *"),
                      id="orggov-scan", replace_existing=True)   # STUDIO-80 升级链（错峰 evolve 4min）
        sched.add_job("studio.reports:daily_report", CronTrigger.from_crontab("30 21 * * *"),
                      id="report-daily", replace_existing=True)
        sched.add_job("studio.reports:weekly_report", CronTrigger.from_crontab("30 9 * * mon"),  # APScheduler 周语义：数字 1=周二（曾致首份周报晚一天）,
                      id="report-weekly", replace_existing=True)
        sched.add_job("studio.reports:monthly_report", CronTrigger.from_crontab("40 9 1 * *"),
                      id="report-monthly", replace_existing=True)
        sched.add_job("studio.daemon:drain_watch", CronTrigger(minute="*/5"),
                      id="drain-watch", replace_existing=True)   # 平时 5 分钟拍；drain 激活后内联快轮询（降噪：30s 拍曾 2880 条/天占 runs 九成）
        sched.add_job("studio.steward:steward_tick", CronTrigger.from_crontab("9,39 * * * *"),
                      id="steward", replace_existing=True)   # 框架管家（STUDIO-83）：半小时拍收割校验+@宰相终验提醒；错峰 9/39 避开 pm(0/4/7 分位)/patrol(5)/evolve(3,13..)
        # 项目日巡三岗（STUDIO-109：ZCode 四定时岗归框架收官，制作人 2026-10-12 定则）。
        # 错峰：pm-daily 08:30（巡检四件事，需求钦点）在 self-eval(08:50) 前扫完前 24h 窗口；
        # games/poly 09:10/09:20 在 self-eval 后取当日消化、weekly(周一9:30)/monthly(1日9:40) 前。
        sched.add_job("studio.dailies:pm_daily", CronTrigger.from_crontab("30 8 * * *"),
                      id="pm-daily", replace_existing=True)
        sched.add_job("studio.dailies:games_daily", CronTrigger.from_crontab("10 9 * * *"),
                      id="games-daily", replace_existing=True)
        sched.add_job("studio.dailies:poly_daily", CronTrigger.from_crontab("20 9 * * *"),
                      id="poly-daily", replace_existing=True)
    from . import runtime
    runtime.SCHED = sched
    runtime.STARTED = time.time()
    return sched


def drain_watch() -> dict:
    """优雅重载哨兵（STUDIO-47A）：平时 5 分钟拍查 drain；激活后内联 30s 快轮询，
    在途清零即记账自退（看护拉起新代码）。"""
    import os, time as _t
    from . import orchestrator as orch
    from .runs import append_run
    ready, why = orch.drain_ready()
    if why == "no-drain":
        return {"result": "IDLE", "actions": []}          # 平时静默（降噪）
    deadline = _t.time() + 3600                            # drain 激活：快轮询至多 1h
    while not ready and _t.time() < deadline:
        _t.sleep(30)
        ready, why = orch.drain_ready()
    if ready:
        append_run("drain-watch", "ok", 0, f"优雅重载：在途清零，自退重启（{why}）")
        os._exit(0)
    return {"result": "WAIT", "actions": [f"drain 轮询超时（{why}），下拍续查)"]}


def run():
    import uvicorn
    from .web import app
    from .config import CONFIG
    from . import orchestrator as _orch
    df = _orch.CONFIG.locks_dir / _orch.DRAIN_FILE
    if df.exists():                        # 上轮优雅重载完成 → 清标志留痕
        import time as _t
        print(f"[daemon] 上轮优雅重载完成（drain 标志清除 {df}），续跑")
        df.unlink()
    sched = _sched()
    sched.start()
    print(f"[studio-daemon] scheduler on; dashboard http://127.0.0.1:{CONFIG.web_port}", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=CONFIG.web_port, log_level="warning")


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "run"
    if cmd == "run":
        run()
    elif cmd == "tick":
        role = sys.argv[2] if len(sys.argv) > 2 else "pm"
        if role == "pm":
            from .orchestrator import pm_tick
            print(pm_tick("POLY"))
        elif role == "selfeval":
            from .metrics import self_eval
            import json
            print(json.dumps(self_eval(), ensure_ascii=False, indent=2))
        elif role == "report":
            from .reports import daily_report
            import json
            print(json.dumps(daily_report(), ensure_ascii=False, indent=2))
        elif role == "steward":
            from .steward import steward_tick
            import json
            print(json.dumps(steward_tick(), ensure_ascii=False, indent=2))
        elif role in ("gamesdaily", "polydaily", "pmdaily"):
            from .dailies import games_daily, poly_daily, pm_daily
            import json
            job = {"gamesdaily": games_daily, "polydaily": poly_daily,
                   "pmdaily": pm_daily}[role]
            print(json.dumps(job(), ensure_ascii=False, indent=2))
    elif cmd == "board":
        from .yt import YT
        from .config import CONFIG
        import json
        from . import statemachine
        rows = []
        for pid in CONFIG.projects:
            rows += YT("agent-8").list(pid, "状态:" + ",".join(statemachine.PM_ACTIONABLE))
        print(json.dumps(rows, ensure_ascii=False, indent=1))
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
