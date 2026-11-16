# Phase0 10 单迁移 diff

- selected=10 imported=10
- ID roundtrip=true
- state matched=10 / exemptions=0
- comments=0（台账无评论表，显式 gap）
- attachments=not-migrated（显式）
- parent：生产 10 单全 SQL NULL → parentTransferred=null（无父）；受控 fixture=true（PH0-11→PH0-12）

## 逐单（含 stateAttempts）
- studio-dev-1495 → PH0-1（id=tkt_c63d449b63ba467ca1889f5128c2e464）desired=6 imported=6 roundtrip=true
  attempts: 2:T1:ok → 3:T2:ok → 4:T3:ok → 5:T6:ok → 6:T7:ok
- studio-dev-1493 → PH0-2（id=tkt_e56bd1bbcd024b40a6598be9257ae6b4）desired=6 imported=6 roundtrip=true
  attempts: 2:T1:ok → 3:T2:ok → 4:T3:ok → 5:T6:ok → 6:T7:ok
- studio-dev-1494 → PH0-3（id=tkt_e1d8deac271d4032bf1ef6049e5a19af）desired=6 imported=6 roundtrip=true
  attempts: 2:T1:ok → 3:T2:ok → 4:T3:ok → 5:T6:ok → 6:T7:ok
- studio-dev-1491 → PH0-4（id=tkt_c8b2c6d586ee4b95a0f26e438bf02e5c）desired=6 imported=6 roundtrip=true
  attempts: 2:T1:ok → 3:T2:ok → 4:T3:ok → 5:T6:ok → 6:T7:ok
- studio-dev-1492 → PH0-5（id=tkt_8d120678411c451dbb825953ab89f1e0）desired=6 imported=6 roundtrip=true
  attempts: 2:T1:ok → 3:T2:ok → 4:T3:ok → 5:T6:ok → 6:T7:ok
- studio-dev-1490 → PH0-6（id=tkt_4451d0a5489f4e219a8a7edc5a73ba86）desired=6 imported=6 roundtrip=true
  attempts: 2:T1:ok → 3:T2:ok → 4:T3:ok → 5:T6:ok → 6:T7:ok
- studio-dev-1489 → PH0-7（id=tkt_76255196511e45c0a440657d52be3602）desired=6 imported=6 roundtrip=true
  attempts: 2:T1:ok → 3:T2:ok → 4:T3:ok → 5:T6:ok → 6:T7:ok
- studio-dev-1488 → PH0-8（id=tkt_7f5ea61e28854b26960c4378aa666e29）desired=6 imported=6 roundtrip=true
  attempts: 2:T1:ok → 3:T2:ok → 4:T3:ok → 5:T6:ok → 6:T7:ok
- studio-dev-1487 → PH0-9（id=tkt_970a984c8b29416db000730c8ef398c6）desired=6 imported=6 roundtrip=true
  attempts: 2:T1:ok → 3:T2:ok → 4:T3:ok → 5:T6:ok → 6:T7:ok
- studio-dev-1486 → PH0-10（id=tkt_0d031f474d42443b98c88b2e46c493ca）desired=6 imported=6 roundtrip=true
  attempts: 2:T1:ok → 3:T2:ok → 4:T3:ok → 5:T6:ok → 6:T7:ok
