# 宰相哨交接文档（ZCode → DSH）

> 制作人 2026-11-02 令：定时任务从 ZCode 宰相迁移到 DSH 侧。本文档为完整交接。

---

## 一、系统现状快照（2026-11-02 16:00 时点）

### 运行中的进程
| 进程 | 状态 | 说明 |
|---|---|---|
| studio-dev daemon | ✅ UP | 唯一常驻进程，PID 见 `pgrep -f studio-dev/daemon.yaml` |
| P1 互联网试点 daemon | ✅ UP | pilot-internet/var/daemon.yaml |
| Taiga (Docker) | ✅ 13 容器 | localhost:9000（网关）/ localhost:8008（Matrix Synapse）|
| host-tunnel3 (launchd) | ✅ UP | 127.0.0.1:9003 exec 隧道（备用） |
| dsh web | ✅ UP | 127.0.0.1:13800（headless worker 用） |

### 已知问题（按优先级）
| # | 问题 | 根因 | 修复单 | 状态 |
|---|---|---|---|---|
| P0 | 活动面 cursor 卡死（反复复发） | activity.ts 修剪逻辑把边界票排除→无限全量重放 | #409 | 在队 |
| P0 | intent 去重不释放回滚键 | DISPATCH 事件永久消费 mirror intent 键 | #417 | 应急修已部署（60b114c），需正式修复 |
| 调查 | mirror 扫描候选过滤器排除 29/47 张 devtask | 未知（可能是并发闸/预算闸/工位检查） | #447 | 在队 |
| P1 | worker bash 工具不可用 | dsh 嵌套沙箱 macOS 拒绝 sandbox_apply | #410 | 在队 |
| P1 | 闸门口径与 report 型岗错配 | 会话终态判定逻辑与四要件不对齐 | #404 | 在队 |

### 两条管线分流
- **定时岗管线（入口 C=调度器）**：✅ 正常——运维/健康/情报巡逻持续交付（今日 77+ 张闭环）
- **devtask 管线（入口 A=活动面 + B=镜像扫描）**：❌ 堵——优化/修复单卡在派发层

---

## 二、哨班例行（每 30 分钟）

### 七问冒烟（必做）
```bash
# ① daemon 活着？
pgrep -f "studio-dev/daemon.yaml"

# ② cursor 推进？（取两次值，3 秒间隔，不同=推进）
sqlite3 /Volumes/BigDisk/companies/studio-dev/ledger.sqlite \
  "select value from daemon_kv where key='activity.cursor'"

# ③ assignee 可见？（Taiga API 列单，看 assigned_to 字段）
# ④ 近 30min 有派发？
sqlite3 /Volumes/BigDisk/companies/studio-dev/ledger.sqlite \
  "select count(*) from events where event='DISPATCH' and ts > (strftime('%s','now')-1800)*1000"

# ⑤ worker 在跑？
pgrep -c -f "bin/dsh --profile headless"

# ⑥ GATE 产出？
sqlite3 /Volumes/BigDisk/companies/studio-dev/ledger.sqlite \
  "select count(*) from events where event in ('GATE_PASS','GATE_FAIL') and ts > (strftime('%s','now')-3600)*1000"

# ⑦ 积压趋势
docker exec taiga-docker-taiga-db-1 psql -U taiga -d taiga -tA -c \
  "select status_id||':'||count(*) from userstories_userstory where project_id=3 and ref>=343 group by status_id order by status_id"
```

### 核心单跟踪
```sql
-- 当前核心优化单（每次检查状态是否变化）
SELECT ref, status_id, subject FROM userstories_userstory 
WHERE ref IN (404, 398, 447, 372, 397, 405, 406) AND project_id=3;
-- status: 21=新单 22=已派发 25=已交付 35=待验收
```

### GitHub 推送（每班）
```bash
cd /Volumes/BigDisk/StudioNext && git push origin dev
```

### 哨班日志
追加到 `docs/sentinel-logs/YYYY-MM-DD.md`，然后 commit+push。

---

## 三、立单方法（Taiga API）

```bash
# 用 Node fetch（能穿透认证振荡窗口）
node -e "
const B='http://127.0.0.1:9000';
const pp=require('fs').readFileSync('/Volumes/BigDisk/credentials/taiga-producer.txt','utf8').split('\n')[0].split(/\s+/);
(async()=>{
  const lr=await fetch(B+'/api/v1/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:pp[0],password:pp[2],type:'normal'})});
  const tok=(await lr.json()).auth_token;
  const H={'Content-Type':'application/json','Authorization':'Bearer '+tok};
  const cr=await fetch(B+'/api/v1/userstories',{method:'POST',headers:H,body:JSON.stringify({
    project:3, status:21, subject:'[devtask] 标题', description:'描述'
  })});
  const nu=await cr.json();
  // 秒级配属性（必须在创建后 1 秒内完成，否则意图去重墙吃掉）
  await fetch(B+'/api/v1/userstories/custom-attributes-values/'+nu.id,{method:'PATCH',headers:H,body:JSON.stringify({
    version:1, attributes_values:{'6':'devtask','7':'departments/研发部','8':1}
  })});
  console.log('created ref='+nu.ref);
})();
"
```

**立单三字段**：`{'6':'devtask', '7':'departments/研发部', '8':<level>}`——缺值或延迟=意图被吃=不派。

---

## 四、验收流程

### 看到待验收（status 35）时
1. 读工位报告：`.AIWS/departments/<部门>/<工号>/tickets/<单号>/att<N>/REPORT.md`
2. 检查四要件：终态 completed + 输出非空 + REPORT 落盘 + 闸门 exit=0
3. 质量抽查：内容是否达标、有无伪造
4. 通过→PATCH status=25（已交付），不通过→PATCH status=20（搁置）或回退重做

### 代签授权
制作人 2026-11-01 授权：已批方向线内由宰相直接代签。签注格式：
```
批示:批准 <验收理由>
—— <署名>（宰相·代制作人签：制作人授权留痕）
```

---

## 五、红线（每次操作前检查）

1. **密钥永不入库/提示词/台账**——凭据只在 `/Volumes/BigDisk/credentials/`（0700）
2. **平台事实源禁 DB 直写**——Taiga 数据只走 API，不直接写 PostgreSQL
3. **不杀活 worker、不动在途单**
4. **不 force push、不重写历史**
5. **推送前扫描**——密钥/本机路径(/Users/xieqingxin)/IP 不得出现
6. **宰相不写代码**——只观察、派单、验收

---

## 六、关键路径速查

| 用途 | 路径 |
|---|---|
| 框架仓 | /Volumes/BigDisk/StudioNext |
| 公司目录 | /Volumes/BigDisk/companies/studio-dev |
| daemon 配置 | /Volumes/BigDisk/companies/studio-dev/daemon.yaml |
| agent.yaml（执行器） | /Volumes/BigDisk/companies/studio-dev/agent.yaml |
| 台账 | /Volumes/BigDisk/companies/studio-dev/ledger.sqlite |
| daemon 日志 | /Volumes/BigDisk/companies/studio-dev/logs/boot-*.log |
| 组织配置 | /Volumes/BigDisk/companies/studio-dev/company/org-config.yaml |
| 员工档案 | /Volumes/BigDisk/companies/studio-dev/company/departments/*/people/ |
| 员工工作区 | /Volumes/BigDisk/companies/studio-dev/.AIWS/ |
| 凭据目录 | /Volumes/BigDisk/credentials/（0700） |
| 自优化宪章 | /Volumes/BigDisk/StudioNext/docs/88-自优化守护程序.md |
| 多公司+GUI | /Volumes/BigDisk/StudioNext/docs/89-多公司验证与GUI程序.md |
| 自主存活 | /Volumes/BigDisk/StudioNext/docs/90-自主存活架构.md |
| 哨班日志 | /Volumes/BigDisk/StudioNext/docs/sentinel-logs/ |

---

## 七、凭据清单（位置和用途，值不写入本文档）

| 文件 | 用途 |
|---|---|
| credentials/taiga-producer.txt | Taiga 项目管理（立单/验收/搁置） |
| credentials/taiga-service-admin.txt | Taiga admin（daemon 启动用） |
| credentials/studio-dev-accounts.txt | 全员工号密码（验收代签用 PRIME-0） |
| credentials/matrix-studionext-bot.txt | Matrix bot |
| credentials/studio-gateway-secret.txt | 网关签根 |
| ~/.dsh/.env | DEEPSEEK_API_KEY + GLM_AUTH_TOKEN |

---

## 八、自优化程序摘要

**八轨轮值**（docs/88 §三）：
1. 提示词优化 2. 岗位组织审计 3. 前沿搜索对比 4. DSH 插件资产化
5. Agent 工作面审计 6. 综合汇总 7. 多公司验证 8. GUI 使用面

**常设岗**（org-config jobs）：
- `ops-infra-patrol-综合部`：每小时（OPS-1）——基础设施巡查
- `arch-frontier-watch-综合部`：每 6 小时（INT-1）——全球前沿架构监视
- 运维/健康/情报巡逻等定时岗（每小时/每日）

**在队核心单**（按优先级）：
1. **404** 闸门口径修复（解 WORKER_DEAD=并发之钥）
2. **447** mirror 扫描过滤器调查（解 29/47 张被排除）
3. **398** 自动派工分配器落仓
4. 372 守护核 / 397 runbook / 405 GUI / 406 插件 / 399-403 V2 审计

---

## 九、注意事项

1. **认证振荡**：Taiga API 会间歇性拒绝认证请求（分钟级窗口）。**Node fetch 通常能穿透**，Python urllib 不行。如果 API 401，等几分钟或换 Node fetch 重试。
2. **intent 去重墙**：一旦单据产生 DISPATCH 事件，其 mirror intent 键被永久消费。应急修已部署（source 加 updated 时间戳），但需正式修复。
3. **两条管线**：定时岗走调度器（正常），devtask 走活动面+镜像扫描（堵）。修复 #409/#447 后 devtask 应恢复。
4. **Git 分支**：只保留 dev 和 master（已清理 160+ 分支）。每天推送到 origin。
5. **P1 试点**：pilot-internet daemon 也在跑（localfile 平台），多公司验证用。

---

*交接人：ZCode 宰相（GLM-5.3）*
*接收人：DSH 侧 agent*
*制作人令：2026-11-02*
