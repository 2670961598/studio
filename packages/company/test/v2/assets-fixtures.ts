/**
 * assets 域 V2 夹具（IMPL-05-01/02）——只造目录树/清单/最小 PKG-DEF，不含断言。
 *
 * 形状依据：v2/06 §3.2（ASSET-01 清单）、§4.1（目录契约）、§4.5（DSH 插件形态沿 51-D-4）、
 * v2/10 §4.4（资产清单字段）、§4.7（.studio-next.yaml 戳记名单）。
 * 摘要用实现面 `digestAssetDirectory` 计算（byteDigest——资产文件是字节）。
 *
 * 纪律：全部落 os.tmpdir() 下 mkdtemp 根；不写仓内文件、不碰 templates/；无 LLM 打桩。
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { stringify } from 'yaml'
import { digestAssetDirectory, type AssetBinding, type AssetKind } from '../../src/assets/index.ts'

/** 临时根（测试自清理；不占用仓内路径） */
export async function makeTempRoot(tag: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), `studio-next-${tag}-`))
}

/** 批量写文件树（自动建父目录） */
export async function writeTree(root: string, files: Record<string, string | Buffer>): Promise<void> {
  for (const [rel, data] of Object.entries(files)) {
    const abs = path.join(root, rel)
    await mkdir(path.dirname(abs), { recursive: true })
    await writeFile(abs, data)
  }
}

/** 相对目录的 byte 摘要（测试夹具与实现同法——不作「独立复算」证据） */
export async function digestAt(root: string, rel: string): Promise<string> {
  return (await digestAssetDirectory(path.join(root, rel))).value
}

/** DSH 插件最小合法形态（51-D-4：package.json name/version + dsh.bundle.patch 在位） */
export function pluginTree(name: string, version = '1.0.0', extraFiles: Record<string, string> = {}): Record<string, string> {
  return {
    'package.json': `${JSON.stringify({ name, version, type: 'module', dsh: { bundle: { patch: './cordis.patch.yml' } } }, null, 2)}\n`,
    'cordis.patch.yml': `- insert:\n    - id: ${name}\n      name: ./src/index.mjs\n      config: {}\n`,
    'src/index.mjs': `export const name = '${name}'\nexport function apply() {\n  return name\n}\n`,
    ...extraFiles,
  }
}

/** 资产清单条目规格（digest 由 writeAssetsManifest 计算或显式覆盖） */
export interface AssetSpec {
  assetId: string
  type: AssetKind
  /** 资产目录（相对公司/包根；plugin+exclusive 用 plugins/<id>，其余 assets/<id>） */
  rel: string
  binding?: AssetBinding
  targetExecutor?: string
  required?: boolean
  availabilityNeed?: 'needed' | 'optional'
  /** 覆盖摘要（造摘要不符） */
  digestOverride?: string
  /** 声明许可（缺省不声明→「待有权者决定」） */
  license?: boolean
  /** 来源版本（REC-ASSET-01 桥用；缺省不表达） */
  version?: string
}

/** 写 assets.yaml（字段严格按 SCH-ASSET-01；未给 binding 时省略以触发 W-SCH-002） */
export async function writeAssetsManifest(root: string, specs: readonly AssetSpec[]): Promise<void> {
  const assets = []
  for (const spec of specs) {
    const digest = spec.digestOverride ?? (await digestAt(root, spec.rel))
    assets.push({
      assetId: spec.assetId,
      type: spec.type,
      contentDigest: { algorithm: 'sha-256', value: digest, kind: 'byte' },
      provenance: {
        publisher: 'studio-next.test',
        ...(spec.version !== undefined ? { version: spec.version } : {}),
        ...(spec.license === true ? { license: { licenseId: 'mit', scope: '夹具声明：只覆盖测试包' } } : {}),
      },
      ...(spec.binding !== undefined ? { binding: spec.binding } : {}),
      ...(spec.targetExecutor !== undefined ? { targetExecutor: spec.targetExecutor } : {}),
      requiredness: {
        required: spec.required ?? false,
        impactNote: spec.required === true ? '缺失则公司声明不完整' : '缺失可运行',
      },
      availability: { need: spec.availabilityNeed ?? 'optional', impact: '夹具影响说明' },
    })
  }
  await writeFile(path.join(root, 'assets.yaml'), stringify({ schema: 'studio-next/assets@1', assets }), 'utf8')
}

/** 最小 PKG-DEF 清单（parts 可换；用于 part 类型闭包断言） */
export function packageManifest(
  parts: { partId: string; partType: string }[] = [{ partId: 'definition.main', partType: 'definition' }],
): string {
  return stringify({
    schema: 'studio-next/pkg-def@1',
    artifactId: 'company.asset-demo',
    artifactVersion: '1.0.0',
    specVersion: '2.0.0',
    parts,
  })
}

/** 最小 org-config（v1 形状：company.level 是主张；extra 可注入 identity/信任态字段） */
export function orgConfigFiles(level = 2, extra: Record<string, unknown> = {}): Record<string, string> {
  return {
    'org-config.yaml': stringify({
      schema: 'org-config/v1',
      company: { name: '资产示范公司', slug: 'asset-demo', level },
      ...extra,
    }),
  }
}

/** 最小 .studio-next.yaml（withStamps=true 时带 SCH-PKG-04 四类挂载戳记） */
export function studioNextYaml(withStamps = true): string {
  return stringify({
    schema: 'studio-next/org@1',
    template: 'company-2-level',
    ...(withStamps
      ? {
          created_at: '2026-10-28T00:00:00.000Z',
          last_validated_at: '2026-10-28T01:00:00.000Z',
          last_validation: 'pass',
          framework_version: '0.1.0',
        }
      : {}),
  })
}

/** 捕获抛错（V2 新套件禁 skip：错误路径用显式 try/catch 断言，不靠测试框架异常面） */
export interface CapturedError {
  message: string
  category?: string
  subcause?: string
  detail?: string
}

export async function captureError(fn: () => Promise<unknown> | unknown): Promise<CapturedError> {
  try {
    await fn()
  } catch (err) {
    const classified = err as Error & { category?: string; subcause?: string; detail?: string }
    return {
      message: classified.message,
      ...(classified.category !== undefined ? { category: classified.category } : {}),
      ...(classified.subcause !== undefined ? { subcause: classified.subcause } : {}),
      ...(classified.detail !== undefined ? { detail: classified.detail } : {}),
    }
  }
  throw new Error('期望拒绝/抛错，但调用成功返回——失败面未被验证（V2 负向断言不得空转）')
}
