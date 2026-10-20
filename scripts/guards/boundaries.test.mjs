// boundaries.test.mjs —— 分层宪法机械门禁测试面（DEV-47 / studio-dev-90）
// 红绿夹具逐规则背书（20-§十五.六.4「等价性由测试面背书」）+ 本仓自检（双机制之二：
// 即使有人解开 package.json 的 test 前置串接，vitest 也会因本自检用例而红）。
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { rules as prodRules, lineBaseline } from "./boundary-rules.mjs";
import {
  checkDaemonVertical,
  checkHorizontal,
  checkPlanes,
  checkSizes,
  countLines,
  extractImportSpecs,
  runGuard,
  walkRepo,
  inScope,
} from "./boundaries.mjs";

// ── 夹具：在临时目录搭一棵最小合规树（生产规则直跑——规则文件即被测物） ────────
// 行数口径：file 内容均为「首行注释 + N 行语句」，总行数 = 1 + N。

function makeFixture(mutate) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bc-guard-"));
  const files = {
    "apps/daemon/src/index.ts": `export * from './assembly/serve.ts'\n`,
    "apps/daemon/src/assembly/serve.ts": `import { a } from '../engine/a.ts'\nimport { id } from '../engine/tools/id.ts'\nexport const serve = () => a + id()\n`,
    "apps/daemon/src/engine/a.ts": `import { id } from './tools/id.ts'\nexport const a = () => id()\n`,
    "apps/daemon/src/engine/tools/id.ts": `export const id = () => 'x'\n`,
    "apps/daemon/src/control/h.ts": `export const h = 1\n`,
    "apps/daemon/src/evolve/e.ts": `import { id } from '../engine/tools/id.ts'\nexport const e = id\n`,
    "apps/daemon/src/cli/main.ts": `import { serve } from '../assembly/serve.ts'\nexport const main = serve\n`,
    "apps/daemon/test/engine/a.test.ts": `import { a } from '../../src/engine/a.ts'\nexport const t = a\n`,
    "packages/contract/src/index.ts": `export const c = 1\n`,
    "packages/core/src/index.ts": `import { c } from '@studio-next/contract'\nexport const k = c\n`,
    "packages/store/src/index.ts": `import { c } from '@studio-next/contract'\nimport { k } from '@studio-next/core'\nexport const s = c + k\n`,
    "packages/company/src/index.ts": `import { s } from '@studio-next/store'\nexport const co = s\n`,
  };
  const merged = mutate ? mutate(files) : files;
  for (const [rel, content] of Object.entries(merged)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return { root };
}

const lines = (n) => `// pad\n${"export const p = 1\n".repeat(n)}`; // 1 + n 行

/** 全检便利函数：夹具树 + 可选规则覆盖 → 违例列表。 */
function guard(fixture, override = {}) {
  const r = { ...prodRules, ...override };
  const read = (f) => fs.readFileSync(path.join(fixture.root, f), "utf8");
  const list = fs
    .readdirSync(fixture.root, { recursive: true })
    .filter((p) => fs.statSync(path.join(fixture.root, p)).isFile())
    .map((p) => p.split(path.sep).join("/"));
  return [
    ...checkDaemonVertical(list, read, fixture.root, r),
    ...checkHorizontal(list, read, fixture.root, r),
    ...checkPlanes(list, r),
    ...checkSizes(list, read, r),
  ];
}

describe("countLines / extractImportSpecs 基础件", () => {
  it("wc -l 口径：空文件 0 行；末行无换行计 1 行；末行有换行不虚增", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("a")).toBe(1);
    expect(countLines("a\n")).toBe(1);
    expect(countLines("a\nb\n")).toBe(2);
  });

  it("提取静态/裸/动态/type-only 导入；不误吞字符串与正则里的 from", () => {
    const src = [
      "import { x } from './a.ts'",
      "import type { T } from './b.ts'",
      "import './side-effect.ts'",
      "const m = await import('./dyn.ts')",
      "export * from './re.ts'",
      "export const s = \"from 'not-a-module'\"",
      "export function f() { return /from\\s+'x'/ }",
    ].join("\n");
    expect(extractImportSpecs(src).sort()).toEqual(["./a.ts", "./b.ts", "./dyn.ts", "./re.ts", "./side-effect.ts"]);
  });
});

describe("BC-V 纵轴（daemon 层间冻结边）", () => {
  it("合规夹具 0 违例（含 root→assembly、cli→assembly、engine→tools、evolve→tools）", () => {
    const fx = makeFixture();
    expect(guard(fx)).toEqual([]);
  });

  it("BC-V1：engine 反向引 cli=层间向上红；引 assembly=未冻结边红", () => {
    const fx = makeFixture((files) => ({
      ...files,
      "apps/daemon/src/engine/up.ts": `import { main } from '../cli/main.ts'\nexport const up = main\n`,
      "apps/daemon/src/engine/ass.ts": `import { serve } from '../assembly/serve.ts'\nexport const ass = serve\n`,
    }));
    const v = guard(fx).filter((x) => x.rule === "BC-V1");
    expect(v.map((x) => x.file).sort()).toEqual(["apps/daemon/src/engine/ass.ts", "apps/daemon/src/engine/up.ts"]);
  });

  it("BC-V1：域层横向互引红（engine→evolve）；同域互引自由（engine→engine 不红）", () => {
    const fx = makeFixture((files) => ({
      ...files,
      "apps/daemon/src/engine/lat.ts": `import { e } from '../evolve/e.ts'\nexport const lat = e\n`,
      "apps/daemon/src/engine/same.ts": `import { a } from './a.ts'\nexport const same = a\n`,
    }));
    const v = guard(fx).filter((x) => x.rule === "BC-V1" && x.file.endsWith("lat.ts"));
    expect(v).toHaveLength(1);
  });

  it("BC-V1：src 不得引 daemon src 树外面（src→test 红）", () => {
    const fx = makeFixture((files) => ({
      ...files,
      "apps/daemon/src/engine/peek.ts": `import { t } from '../../test/engine/a.test.ts'\nexport const p = t\n`,
    }));
    expect(guard(fx).some((x) => x.rule === "BC-V1" && x.file.endsWith("peek.ts"))).toBe(true);
  });

  it("BC-V2：src 根散文件红；未冻结顶层目录红", () => {
    const fx = makeFixture((files) => ({
      ...files,
      "apps/daemon/src/stray.ts": `export const s = 1\n`,
      "apps/daemon/src/rogue-domain/x.ts": `export const r = 1\n`,
    }));
    const v = guard(fx).filter((x) => x.rule === "BC-V2");
    expect(v.map((x) => x.file).sort()).toEqual(["apps/daemon/src/rogue-domain/", "apps/daemon/src/stray.ts"]);
  });

  it("BC-V3：域平面超冻结基线红（engine 基线 13：平面第 14 件散文件红，13 件绿）", () => {
    const extra = (n) => Object.fromEntries(
      Array.from({ length: n }, (_, i) => [`apps/daemon/src/engine/f${i}.ts`, `export const f${i} = ${i}\n`]),
    );
    const fxAt = makeFixture((files) => ({ ...files, ...extra(12) })); // 基础 engine 平面 1 件 + 12 = 13
    expect(guard(fxAt).filter((x) => x.rule === "BC-V3")).toEqual([]);
    const fxOver = makeFixture((files) => ({ ...files, ...extra(13) })); // 14 > 13
    expect(guard(fxOver).some((x) => x.rule === "BC-V3" && x.file === "apps/daemon/src/engine/")).toBe(true);
  });

  it("BC-V3 不误伤 contrib 子文件夹：engine/<特性>/ 平面外生长不红", () => {
    const fx = makeFixture((files) => ({
      ...files,
      "apps/daemon/src/engine/new-feature/one.ts": `export const one = 1\n`,
      "apps/daemon/src/engine/new-feature/two.ts": `export const two = 2\n`,
    }));
    expect(guard(fx).filter((x) => x.rule === "BC-V3")).toEqual([]);
  });

  it("BC-V4：engine/tools/ >10 件触发升格红；=10 不红", () => {
    const tools = (n) => Object.fromEntries(
      Array.from({ length: n }, (_, i) => [`apps/daemon/src/engine/tools/t${i}.ts`, `export const t${i} = ${i}\n`]),
    );
    const fxAt = makeFixture((files) => ({ ...files, ...tools(9) })); // 基础 tools 平面 1 件 + 9 = 10
    expect(guard(fxAt).filter((x) => x.rule === "BC-V4")).toEqual([]);
    const fxOver = makeFixture((files) => ({ ...files, ...tools(10) })); // 11 > 10
    expect(guard(fxOver).some((x) => x.rule === "BC-V4")).toBe(true);
  });
});

describe("BC-H 横轴（包间方向表）", () => {
  it("BC-H1：低层引高层红（company→panel）；同层互引红（core→gateway）；未列边红（adapters→store）", () => {
    const fx = makeFixture((files) => ({
      ...files,
      "packages/company/src/up.ts": `import { p } from '@studio-next/panel'\nexport const u = p\n`,
      "packages/core/src/lat.ts": `import { g } from '@studio-next/gateway'\nexport const l = g\n`,
      "packages/adapters/src/x.ts": `import { s } from '@studio-next/store'\nexport const x = s\n`,
    }));
    const v = guard(fx).filter((x) => x.rule === "BC-H1");
    expect(v.map((x) => x.file).sort()).toEqual([
      "packages/adapters/src/x.ts",
      "packages/company/src/up.ts",
      "packages/core/src/lat.ts",
    ]);
  });

  it("BC-H1：允许边绿——store→core、company→store、panel→company、daemon→panel 等表内边不红", () => {
    const fx = makeFixture((files) => ({
      ...files,
      "packages/panel/src/index.ts": `import { co } from '@studio-next/company'\nexport const p = co\n`,
      "apps/daemon/src/cli/panel-cmd.ts": `import { p } from '@studio-next/panel'\nexport const cmd = p\n`,
    }));
    expect(guard(fx).filter((x) => x.rule.startsWith("BC-H"))).toEqual([]);
  });

  it("BC-H2：相对引用越出包边界红；未登记工作区包红", () => {
    const fx = makeFixture((files) => ({
      ...files,
      "packages/core/src/esc.ts": `import { z } from '../../../scripts/guards/boundary-rules.mjs'\nexport const e = z\n`,
      "packages/core/src/unknown.ts": `import { z } from '@studio-next/no-such-pkg'\nexport const u = z\n`,
    }));
    const v = guard(fx).filter((x) => x.rule === "BC-H2");
    expect(v.map((x) => x.file).sort()).toEqual(["packages/core/src/esc.ts", "packages/core/src/unknown.ts"]);
  });

  it("BC-H1：相对路径跨包同样受方向表管（company 以 ../../ 相对引 panel=红）", () => {
    const fx = makeFixture((files) => ({
      ...files,
      "packages/company/src/relup.ts": `import { p } from '../../panel/src/index.ts'\nexport const r = p\n`,
    }));
    expect(guard(fx).some((x) => x.rule === "BC-H1" && x.file.endsWith("relup.ts"))).toBe(true);
  });
});

describe("BC-S 尺寸阈值", () => {
  it("BC-S1：目录直属 26 文件红；25 文件绿", () => {
    const mk = (n) => Object.fromEntries(
      Array.from({ length: n }, (_, i) => [`packages/company/src/sub/f${i}.ts`, `export const f${i} = ${i}\n`]),
    );
    const fxAt = makeFixture((files) => ({ ...files, ...mk(25) }));
    expect(guard(fxAt).filter((x) => x.rule === "BC-S1")).toEqual([]);
    const fxOver = makeFixture((files) => ({ ...files, ...mk(26) }));
    expect(guard(fxOver).some((x) => x.rule === "BC-S1" && x.file === "packages/company/src/sub/")).toBe(true);
  });

  it("BC-S2：新超限件红（601 行）；600 行绿；测试文件同受管", () => {
    const fxOver = makeFixture((files) => ({ ...files, "packages/company/src/big.ts": lines(600) })); // 601 行
    expect(guard(fxOver).some((x) => x.rule === "BC-S2" && x.file === "packages/company/src/big.ts")).toBe(true);
    const fxAt = makeFixture((files) => ({ ...files, "packages/company/src/big.ts": lines(599) })); // 600 行
    expect(guard(fxAt).filter((x) => x.rule === "BC-S2")).toEqual([]);
    const fxTest = makeFixture((files) => ({ ...files, "packages/company/test/big.test.ts": lines(600) }));
    expect(guard(fxTest).some((x) => x.rule === "BC-S2" && x.file === "packages/company/test/big.test.ts")).toBe(true);
  });

  it("BC-S2 ratchet：基线件=基线值绿、超基线红、基线外超限红", () => {
    const content = lines(610); // 611 行
    const base = { "packages/company/src/legacy.ts": 611 };
    const at = makeFixture((files) => ({ ...files, "packages/company/src/legacy.ts": content }));
    expect(guard(at, { lineBaseline: base }).filter((x) => x.rule === "BC-S2")).toEqual([]);
    const over = makeFixture((files) => ({ ...files, "packages/company/src/legacy.ts": `${content}export const q = 2\n` })); // 612 行
    expect(guard(over, { lineBaseline: base }).some((x) => x.rule === "BC-S2" && x.file.endsWith("legacy.ts"))).toBe(true);
    const notListed = makeFixture((files) => ({ ...files, "packages/company/src/other.ts": content }));
    expect(guard(notListed, { lineBaseline: base }).some((x) => x.rule === "BC-S2" && x.file.endsWith("other.ts"))).toBe(true);
  });
});

describe("本仓自检（分层宪法在真仓上的终态断言——双机制之二）", () => {
  const repoRoot = () => path.resolve(import.meta.dirname, "..", "..");

  it("runGuard 对本仓 0 违例——规则文件与真结构互证", () => {
    const { violations, stats } = runGuard(repoRoot());
    expect(violations).toEqual([]);
    expect(stats.scannedFiles).toBeGreaterThan(300);
  });

  it("行数基线与真仓现状一致（每条基线值 ≥ 实测行数且 >600）——冻结时点互证", () => {
    const files = walkRepo(repoRoot()).filter((f) => inScope(f) && f.endsWith(".ts"));
    const actual = new Map(files.map((f) => [f, countLines(fs.readFileSync(path.join(repoRoot(), f), "utf8"))]));
    for (const [f, cap] of Object.entries(lineBaseline)) {
      const now = actual.get(f);
      expect(now, `基线条目 ${f} 应存在于扫描面`).toBeDefined();
      expect(now).toBeLessThanOrEqual(cap);
      expect(cap).toBeGreaterThan(600);
    }
  });
});
