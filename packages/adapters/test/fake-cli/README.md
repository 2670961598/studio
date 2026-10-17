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
| `FAKE_SIGTERM_EXIT` | 设置后吞掉 SIGTERM 默认终止，改以该码退出（dsh 已知坑模拟）；配 `FAKE_HANG` 用 | 不启用（SIGTERM 默认终止） |
| `FAKE_VERSION` | 设置后：命令行含 `--version` 即只打印该值并以 0 退出（executor detect 版本门槛三态测试）；不参与时 `--version` 与普通参数无异 | 不启用 |
| `FAKE_ECHO_ARGS` | `1` = stdout 首行回显收到的 argv（`fake-cli argv: ...`），测适配器 launch 参数注入（预算帽 / 续跑 / 通道旗标） | 不回显 |
| `FAKE_ECHO_ENV` | 逗号分隔 env 变量名：每名一行回显该变量值（`fake-cli env: NAME=值`，未设置时 `<unset>`），测适配器 launch env 注入（TaskBrief.credentials v1.4 透传断言）；只回显点名变量，不倾倒整份 env | 不回显 |
| `FAKE_WIRE_DIR` | 设置后：**正常退出前**把 wire 内容写到 `<dir>/wire.jsonl`（目录递归建）——模拟 kimi「会话目录里落 session wire.jsonl」（docs/17-§6 已知坑：usage 在 wire 不在 stdout） | 不写 wire |
| `FAKE_WIRE_FIXTURE` | wire 内容来源（golden fixture 全文，如 `../fixtures/kimi/stdout-basic.wire.jsonl`） | 空文件 |

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

# dsh 已知坑：挂起后吞 SIGTERM、以退出码 0 死（docs/17-§6——成功判定只认流内终态，非退出码）
FAKE_FIXTURE=../fixtures/dsh/killed-mid-step.ndjson FAKE_HANG=1 FAKE_SIGTERM_EXIT=0 node fake-cli.mjs

# kimi 场景：stdout 吐流（无 usage）+ 正常退出前落一份 wire.jsonl（usage 在里面——
# 适配器会话结束后读取合流，docs/17-§6 已知坑）
FAKE_FIXTURE=../fixtures/kimi/stdout-basic.jsonl \
FAKE_WIRE_DIR=/tmp/fake-kimi-session FAKE_WIRE_FIXTURE=../fixtures/kimi/stdout-basic.wire.jsonl \
node fake-cli.mjs
```

## 边界语义

- `FAKE_VERSION` 短路优先于一切：设置且 argv 含 `--version` 时连 fixture 回放都跳过；未设置时收到
  `--version` 走原路径（fixture/退出码旋钮照常生效），与旧版行为完全一致。
- 未设 `FAKE_SIGTERM_EXIT` 时不注册信号处理器：SIGTERM 走 Node 默认终止（被杀即死，无退出码）。
- 设置 `FAKE_SIGTERM_EXIT=<码>` 即注册处理器：吞掉 SIGTERM 默认终止，以该码 `process.exit`
  ——模拟 dsh「被 kill 后退出码=0 且 final 为空」的坑位（docs/17-§6）；SIGKILL 仍不可吞。
- stdout 写入用同步 `writeSync`：`process.exit` 前无缓冲残留，管道场景不会截断。
- 消费端提前关管道（EPIPE）按被终止处理，静默退出。
- `FAKE_WIRE_DIR` **仅在正常退出路径写**（`process.exit(exitCode)` 前，退出码 0/非 0 皆写）：
  挂起（`FAKE_HANG`）、被信号杀死、EPIPE、`FAKE_VERSION` 探测短路均不写——会话未正常结束，
  wire 不落（与「被杀会话 wire 缺失 → 适配器明示 + 不折算」的测试面配套）。
