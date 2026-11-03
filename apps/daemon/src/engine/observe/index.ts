/**
 * engine/observe —— 观察面（PORT-OBS 写槽实现＋OBS 记录写面＋相位 1 尾拍内步骤）出口
 *
 * 依据：docs/17-§2（观察面挂相位 1 采集尾，相位内步骤不增删相位）、docs/17-§6（观测写入
 * 不参与收割判定、写失败不冒认）、docs/v2/14 §1.8（PORT-OBS.reportFault 唯一写槽）、
 * docs/v2/11 §十二（REC-OBS-02/03/04）、docs/v2/08 §4.4/§5.3；studio-dev-539。
 *
 * 三分件：types.ts（类型面）｜port.ts（端口语义：ctx 校验/错误分类/回执）｜tick.ts（拍内状态机）。
 */
export {
  createObservationTickStep,
  OBS_INDEPENDENT_CHANNEL,
  OBS_SELF_FACES,
  OBS_SELF_VIEW,
  OBS_SUBJECT_KIND,
  OBS_WATCH_WINDOW_MS,
  type ObservationTickStepDeps,
} from './tick.ts'
export { createObservationWritePort, type ObservationWritePortDeps } from './port.ts'
export type {
  ObsClosureInput,
  ObsCollectFailure,
  ObsProjectionFault,
  ObsProjectionRead,
  ObsRecordAck,
  ObsTickInput,
  ObsTickOutcome,
  ObsTickReport,
  ObsWatchInput,
  ObservationRecordWriter,
  ObservationTickStep,
  ObservationWritePort,
} from './types.ts'
