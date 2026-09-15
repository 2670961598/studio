"""daemon — 入口：APScheduler 装配 + uvicorn 仪表盘
用法:
  python -m studio.daemon run          # 常驻（launchd KeepAlive 拉起）
  python -m studio.daemon tick pm|qa|selfeval   # 手动跑一岗（调试/冒烟）
  python -m studio.daemon board        # 打印板面快照
错峰表照宪章 §4：pm 0 分位、qa 7 分位；max_instances=1 防自身重叠。"""
import sys, threading, time


def _sched():
    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.triggers.cron import CronTrigger
    from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
    from .config import CONFIG
    sched = BackgroundScheduler(
        jobstores={"default": SQLAlchemyJobStore(
            url=f"sqlite:///{CONFIG._root / 'jobs.sqlite'}")},
        job_defaults={"max_instances": 1, "coalesce": True, "misfire_grace_time": 300})
    # 文本引用保证 job 可序列化进 SQLite jobstore
    sched.add_job("studio.orchestrator:pm_tick", CronTrigger.from_crontab("0,10,20,30,40,50 * * * *"),
                  kwargs={"pid": "POLY"}, id="pm-poly", replace_existing=True)
    sched.add_job("studio.orchestrator:qa_tick", CronTrigger.from_crontab("7,17,27,37,47,57 * * * *"),
                  id="qa", replace_existing=True)
    sched.add_job("studio.metrics:self_eval", CronTrigger.from_crontab("50 8 * * *"),
                  id="self-eval", replace_existing=True)
    return sched


def run():
    import uvicorn
    from .web import app
    from .config import CONFIG
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
        elif role == "qa":
            from .orchestrator import qa_tick
            print(qa_tick())
        elif role == "selfeval":
            from .metrics import self_eval
            import json
            print(json.dumps(self_eval(), ensure_ascii=False, indent=2))
    elif cmd == "board":
        from .yt import YT
        from .config import CONFIG
        import json
        from . import statemachine
        rows = []
        for pid in CONFIG.projects:
            rows += YT("agent-pm").list(pid, "状态:" + ",".join(statemachine.PM_ACTIONABLE))
        print(json.dumps(rows, ensure_ascii=False, indent=1))
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
