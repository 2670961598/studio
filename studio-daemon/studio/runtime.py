"""runtime — 跨模块共享的运行时句柄（避免 -m 双模块实例陷阱）"""
SCHED = None   # BackgroundScheduler 实例（daemon 启动时写入）
STARTED = 0    # daemon 启动时刻（epoch）
