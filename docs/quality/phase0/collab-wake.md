# Phase0 collab mention→wake

- rooms: broadcast/group/dm
- directed mention wake: 3 个
- idempotent send replayed=true
- ack: acked=3 / replay alreadyAcked=3
- read cursor: group=0 broadcast=0 dm=0
- broadcast/DM send+read+ack 均覆盖；duplicate ack（不同 key）alreadyAcked=3

## Matrix face 差距
- vendor collab 无 relay/lease API：本 PoC 用进程内 lease map 模拟，P1 缺口（生产需 relay 投递/租约/重试）
- 无跨进程/跨节点 wake 推送；daemon Matrix face 依赖 Matrix 事件回执，需 sidecar 适配器
- 无 daemon PORT/事件台账对接；READ/WAKE/ACK 状态需映射到 daemon 观测面
- vendor read cursor 为 HMAC 绑定 room+principal；daemon Matrix face 需按公司/租户封装密钥
- 许可/授权风险已由 Phase0 切片1 PROVENANCE 记录（无 LICENSE，制作人授权）
