/**
 * 拖动排序期间的全局锁。
 *
 * 为什么需要它：验证码每秒轮询一次，每次都会触发 React 重渲染。
 * 拖动过程中重渲染会带来两个问题：
 * 1. 帧率下降，拖动明显卡顿（几十张卡片同时 reconcile）；
 * 2. React 更新 className 时会覆盖 JS 动态加的类，拖动状态被意外清除。
 *
 * 因此拖动期间暂停轮询：验证码数字在拖动的一两秒内不刷新完全可以接受，
 * 而拖动的跟手程度是用户能直接感知的。
 *
 * 用独立模块而不是 React state：轮询逻辑在 AppContext 里，
 * 拖动逻辑在 useDragSort 里，两者没有组件层级关系，
 * 走 state 需要把状态提升到共同祖先并层层传递，代价远大于收益。
 */

let locked = false;

/** 进入/退出拖动时调用 */
export function setDragLock(value: boolean): void {
  locked = value;
}

/** 轮询前检查：为 true 时跳过本次取码 */
export function isDragLocked(): boolean {
  return locked;
}
