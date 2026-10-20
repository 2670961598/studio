/**
 * theme —— Naive UI 暗色主题调校（DEV-1 方案 §7.5：darkTheme 基底 + 灰阶调校
 * 对齐旧页 Linear 风底色；组件样式全归 Naive CSS-in-JS，本目录零 CSS 文件）。
 */
import { darkTheme } from 'naive-ui'

export { darkTheme }

/** 调色板（旧页沿用的灰阶 + teal 主色，换装不换观感基调） */
export const PANEL_PALETTE = {
  bg: '#101418',
  card: '#161c22',
  border: '#263238',
  teal: '#80cbc4',
  due: '#ff8a65',
  ok: '#a5d6a7',
  fail: '#ef9a9a',
  warn: '#fff59d',
  text: '#cfd8dc',
  dim: '#90a4ae',
}

/** Naive UI 主题覆写（common 键——面板级灰阶/圆角/字体，图表配色归 charts/options.js） */
export const panelThemeOverrides = {
  common: {
    bodyColor: PANEL_PALETTE.bg,
    cardColor: PANEL_PALETTE.card,
    modalColor: '#1a2128',
    popoverColor: '#1a2128',
    tableColor: PANEL_PALETTE.card,
    inputColor: '#11161b',
    borderColor: PANEL_PALETTE.border,
    dividerColor: PANEL_PALETTE.border,
    primaryColor: PANEL_PALETTE.teal,
    primaryColorHover: '#a5d6a7',
    primaryColorPressed: '#4db6ac',
    primaryColorSuppl: PANEL_PALETTE.teal,
    textColorBase: '#eceff1',
    textColor1: '#eceff1',
    textColor2: PANEL_PALETTE.text,
    textColor3: PANEL_PALETTE.dim,
    fontFamily:
      'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
    fontSize: '13px',
    fontSizeSmall: '12px',
    borderRadius: '6px',
  },
  Card: {
    borderColor: PANEL_PALETTE.border,
  },
}
