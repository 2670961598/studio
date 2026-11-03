/**
 * 一级单元值集（ENU-140；docs/v2/09 §二、docs/v2/10 §4.3）。
 *
 * 单一事实源：validator（unit-fields.ts）与纯投影（projection/types.ts）共用同一字面量，
 * 避免两处各写一份值集后在「只增不改义」纪律下漂移。纯常量、零 IO。
 */
export const UNIT_VACANCY_STATES = ['staffed', 'head-vacant'] as const
export type UnitVacancyState = (typeof UNIT_VACANCY_STATES)[number]
