# fake CLI harness

可配置假 CLI，供未来 executor 适配器（dsh / claude / codex / kimi）的 spawn 测试使用。
依据 `docs/18-§1.3 独立测试套件`：模拟各家 CLI 的 stdout / 退出行为，覆盖已知坑场景。

## 用法

统一用 `node` 直跑（无 shebang，避免依赖问题）：

```bash
FAKE_FIXTURE=../fixtures/dsh/turn-completed.ndjson node fake-cli.mjs
```

四家 CLI 的真实流形态不用本脚本伪造——直接回放 `../fixtures/` 下的 golden 样本；
本脚本只控制「输出什么、怎么退、挂不挂」。

## 环境变量旋钮

| 变量 | 含义 | 缺省 |
|---|---|---|
| `FAKE_FIXTURE` | golden fixture 文件路径，内容写到 stdout | 空（无输出） |
| `FAKE_EXIT` | 进程退出码 | `0` |
| `FAKE_HANG` | `1` = 输出后挂起不退出，直到被 SIGTERM/SIGKILL | 不挂起 |
| `FAKE_DELAY_MS` | 逐行输出间隔（毫秒），用于测增量流消费 | `0`（整块输出） |

## 场景示例

```bash
# 回放 dsh 完整流（stdout 与 fixture 逐字节一致，退出码 0）
FAKE_FIXTURE=../fixtures/dsh/turn-completed.ndjson node fake-cli.mjs

# 回放 claude 错误终态并以码 3 退出（适配器须以流内 result 事件为准，不能只看退出码）
FAKE_FIXTURE=../fixtures/claude/result-error.jsonl FAKE_EXIT=3 node fake-cli.mjs

# 挂起场景：输出后不退出，测适配器 kill(h, grace) 的 SIGTERM→SIGKILL 链路
FAKE_FIXTURE=../fixtures/codex/turn-completed.jsonl FAKE_HANG=1 node fake-cli.mjs

# 缓慢吐行：测 stream() 的异步增量消费
FAKE_FIXTURE=../fixtures/kimi/stdout-basic.jsonl FAKE_DELAY_MS=50 node fake-cli.mjs
```

## 边界语义

- 未注册信号处理器：SIGTERM 走 Node 默认终止（被杀即死，无退出码）。
  「dsh 被 kill 后退出码=0 且 final 为空」的坑位模拟（docs/17-§6）属于 dsh 适配器
  kill 测试的专用旋钮，落地时在此追加。
- stdout 写入用同步 `writeSync`：`process.exit` 前无缓冲残留，管道场景不会截断。
- 消费端提前关管道（EPIPE）按被终止处理，静默退出。
