// boundary-rules.mjs —— 分层宪法规则数据（唯一冻结源；DEV-47 / studio-dev-90）
// 宪法正文：docs/20-工程总规程.md §十五（人文镜像——冲突时以本文件为准并回改文档）。
// 修订纪律：层位表/允许边/阈值/平面基线/行数基线值上调与新增 = 判据类资产修订 =
// 提案流 + 制作人批（20-§九/§十五）；基线值下降与条目除名随任意提交顺带办理。
// 本文件被 scripts/guards/boundaries.mjs（执行引擎）与 boundaries.test.mjs（测试面）共用。

/** 扫描范围：apps/* 与 packages/* 的 src/ 与 test/ 全目录树（templates/docs/scripts 不扫，§十五.七）。 */
export const scopeDirs = ["apps", "packages"];

/** 计入行数门/依赖扫描的代码扩展名。 */
export const codeExtensions = [".ts", ".mts", ".cts", ".mjs", ".cjs", ".js"];

/** 工作区包名前缀（bun workspaces，@studio-next/<目录名>[/子路径]）。 */
export const workspaceScope = "@studio-next/";

// ─────────────────────────────────────────────────────────────────────────────
// 一、daemon 纵轴（包内 vscode 式分层；DEV-45b 五域+根入口）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 纵轴层位（数字越大越靠上）。同层=同域，域内互引自由；跨层只准沿 allowedVerticalEdges
 * 自上而下。root = apps/daemon/src/index.ts（纯入口，D2）。
 */
export const daemonLayers = {
  root: 6,
  cli: 5,
  assembly: 4,
  control: 3,
  evolve: 3,
  engine: 3,
  "engine/tools": 2,
};

/** 冻结的层间允许边（[自, 至]；未列出=违例——含一切反向边与未冻结的层间边）。 */
export const allowedVerticalEdges = [
  ["root", "assembly"],
  ["cli", "assembly"],
  ["cli", "control"],
  ["cli", "evolve"],
  ["cli", "engine"],
  ["cli", "engine/tools"],
  ["assembly", "control"],
  ["assembly", "evolve"],
  ["assembly", "engine"],
  ["assembly", "engine/tools"],
  ["control", "engine/tools"],
  ["evolve", "engine/tools"],
  ["engine", "engine/tools"],
];

/** src 根平面纪律（§十五.四.3）：根平面唯一允许的散文件。 */
export const daemonSrcRootFiles = ["index.ts"];

/** src 根平面允许的子目录（五域；新顶层目录=违例）。 */
export const daemonSrcRootDirs = ["engine", "control", "evolve", "cli", "assembly"];

/**
 * 域平面基线（contrib 模式，§十五.四.1）：域目录直属 .ts 文件数上限，只减不增。
 * 新特性=开 <域>/<特性>/ 子文件夹；cli/ 不冻结（一命令一模块生长，受通用目录阈约束）。
 */
export const domainPlaneBaselines = {
  engine: 13,
  control: 2,
  evolve: 5,
  assembly: 1,
};

/**
 * base 升格阈值（§十五.五）：engine/tools/ 直属文件数 >toolsPromotionFileCount
 * → 违例（提示升格 packages/base）。升格前 tools 平面自然生长，不受域平面冻结约束。
 */
export const toolsPromotionFileCount = 10;

// ─────────────────────────────────────────────────────────────────────────────
// 二、横轴（包间方向表；层位数字越大越靠上，只准高层引低层）
// ─────────────────────────────────────────────────────────────────────────────

/** 包目录名 → 层位。daemon=apps/daemon（应用顶）；其余为 packages/<目录名>。 */
export const packageLayers = {
  daemon: 5,
  panel: 4,
  api: 4,
  prompt: 4,
  "studio-tools": 4,
  company: 3,
  store: 2,
  adapters: 1,
  core: 1,
  gateway: 1,
  localplatform: 1,
  matrix: 1,
  yt: 1,
  taiga: 1,
  "dsh-bridge": 1, // 仓内零模块入边——daemon 以路径引用消费（BRIDGE_SRC_REL，§十五.七不扫）
  contract: 0,
};

/**
 * 冻结的包间允许边（[源包, 目标包]）——与各包 package.json 声明依赖并集一致
 * （daemon→api/prompt/yt 为已声明休眠边，一并冻结为允许）。未列出的跨包依赖=违例。
 */
export const allowedPackageEdges = [
  // —— apps/boot（105-刀A Matrix 装配单元，studio-dev-123 宰相亲批入表 2026-10-21）——
  ["boot", "contract"],
  ["boot", "daemon"],
  ["boot", "matrix"],
  ["daemon", "panel"],
  ["daemon", "api"],
  ["daemon", "prompt"],
  ["daemon", "studio-tools"],
  ["daemon", "company"],
  ["daemon", "store"],
  ["daemon", "adapters"],
  ["daemon", "core"],
  ["daemon", "gateway"],
  ["daemon", "localplatform"],
  ["daemon", "taiga"],
  ["daemon", "yt"],
  ["daemon", "contract"],
  ["panel", "company"],
  ["panel", "store"],
  ["panel", "contract"],
  ["api", "company"],
  ["api", "store"],
  ["api", "contract"],
  ["prompt", "company"],
  ["prompt", "contract"],
  ["studio-tools", "gateway"],
  ["studio-tools", "contract"],
  ["company", "localplatform"],
  ["company", "store"],
  ["company", "contract"],
  ["store", "core"],
  ["store", "contract"],
  ["adapters", "contract"],
  ["core", "contract"],
  ["gateway", "contract"],
  ["localplatform", "contract"],
  ["matrix", "contract"],
  ["yt", "contract"],
  ["taiga", "contract"],
];

// ─────────────────────────────────────────────────────────────────────────────
// 三、尺寸阈值（§十五.三）
// ─────────────────────────────────────────────────────────────────────────────

/** 目录直属文件数上限：>此值=违例（必须切子域）。 */
export const maxFilesPerDirectory = 25;

/** 文件行数上限：>此值=违例（必须拆；测试文件在内，不留豁免面）。 */
export const maxLinesPerFile = 600;

/**
 * 行数基线（ratchet，只减不增；立宪时已超限件的冻结行数，wc -l 口径）。
 * 基线内件超基线值=违例；降至 ≤600 可随任意提交除名；上调/新增=提案流（§十五.三.3）。
 * 清偿义务：每里程碑对账点核对净变化——只许净减（§十五.三.4）。
 */
export const lineBaseline = {
  "apps/daemon/src/engine/engine.ts":     2304, // 184 叠加态
  "packages/store/src/records.ts": 606,
  "packages/store/src/ledger.ts": 1684, // 179 132-D 定型面缝并入（叠加态实测 2026-10-23）
  "apps/daemon/src/assembly/serve.ts":     1594, // 184 叠加态
  "packages/company/src/repo-validate.ts": 1021,
  "apps/daemon/test/control/hot-reload.test.ts": 930,
  "apps/daemon/test/engine/scheduler.test.ts": 785,
  "packages/company/src/dependencies.ts": 775,
  "packages/company/test/repo-validate.test.ts": 766,
  "apps/daemon/test/engine/sources.test.ts": 768, // 105-刀A 唤醒源测试(+19)
  "packages/adapters/src/dsh.ts": 758, // 132-§6.1 单A 账目面(+32：aggregateUsage 四桶真值直录+DshAdapterOptions.model 归一注入——studio-dev-168 过审落位；前值 726)
  "packages/taiga/src/testutil.ts": 723,
  "packages/adapters/test/dsh.test.ts": 785, // 132-§6.1 单A 判负线⑤(+70：四桶归并/model 注入/无缓存桶三测试——studio-dev-168；前值 715)
  "packages/panel/src/views.ts": 662,
  "packages/adapters/test/kimi.test.ts": 662, // 132-§6.1 单A 桶键统一(+1：cached→cache_read 断言注释——studio-dev-168；前值 661)
  "apps/daemon/test/evolve/evolution-e2e.test.ts": 652,
  "packages/company/src/validator.ts": 655, // 130-P1 类型收件态(+1：接线行——规则体=type-inbox.ts 拆出) // 170 127-C 州表卫生(+7：接线行) // 前值 654/647
  "apps/daemon/test/evolve/gray.test.ts": 625,
  "apps/daemon/src/control/hot-reload.ts": 624,
  "packages/panel/src/overview/views.ts": 629, // 170 127-C 州表卫生映射层(+11：stateMapping 形参+口径注) // 前值 618=DEV-12 刀二
  "packages/store/test/v5-candidates.test.ts": 602,
};

// ─────────────────────────────────────────────────────────────────────────────
// 四、包内反向静态边（studio-dev-126 T7=BC-T1，studio-dev-104 提案 §1-A①；
//     2026-10-21 制作人全批——判据类资产新增随提案落地）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 指定目录树内禁用的 import spec（字面量匹配，含 .ts 扩展——仓内引用惯例全显式扩展）。
 * 与横轴（包间）正交：本表管**包内**子目录间的方向面——高层域可引低层域，反向=违例。
 */
export const forbiddenImportSpecs = [
  {
    rule: "BC-T1",
    under: "packages/taiga/src/transport/",
    specs: ["../fieldmap.ts"],
    why: "transport（传输域）不得反向依赖 fieldmap（域映射域）——fieldmap→transport 合法、transport→fieldmap=反向静态边；域映射口以结构化类型（FieldMapLike，transport/context.ts）注入，依赖面与实例缓存解耦（§十五.二同则的包内面）",
  },
];

/** 汇总导出（引擎消费的完整规则集）。 */
export const rules = {
  scopeDirs,
  codeExtensions,
  workspaceScope,
  daemonLayers,
  allowedVerticalEdges,
  daemonSrcRootFiles,
  daemonSrcRootDirs,
  domainPlaneBaselines,
  toolsPromotionFileCount,
  packageLayers,
  allowedPackageEdges,
  maxFilesPerDirectory,
  maxLinesPerFile,
  lineBaseline,
  forbiddenImportSpecs,
};
