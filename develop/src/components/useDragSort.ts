import { useCallback, useEffect, useRef } from "react";
import { setDragLock } from "../lib/dragLock";

/**
 * 长按拖动排序。
 *
 * 桌面端与移动端行为完全一致：按住卡片 1 秒进入拖动，
 * 期间卡片底部进度条从 0 填满，明确告知「正在长按」。
 *
 * 事件模型：
 * - 触屏用原生 touch 事件跟踪（touchmove / touchend / touchcancel）。
 *   不用 pointer 事件：浏览器在长按后接管手势会发 pointercancel，
 *   而 pointercancel 之后不再有 pointermove，拖动会直接卡死。
 *   touchmove 只要 preventDefault 就能阻止浏览器接管，不会被打断。
 * - 鼠标用 pointer 事件跟踪。
 *
 * 为什么 touchmove 监听必须在 pointerdown 时就注册：
 * 若等到长按成功（1 秒后）才注册，浏览器此时可能已经进入「滚动预备」
 * 状态，第一个 touchmove 拦不住，页面会跟着滚、拖动被取消。
 * 提前注册后，进入拖动的第一个 touchmove 就能 preventDefault。
 *
 * 为什么状态用 data-* 属性而不是 class：
 * 验证码每秒轮询一次会触发 React 重渲染，React 更新 className 时
 * 会把 JS 动态加的类整个覆盖掉，拖动状态被意外清除（表现为
 * 「倒计时一跳就取消拖动」）。data-* 属性不在 React 的受控范围内，
 * 不会被覆盖。
 *
 * 为什么用 CSSOM 写 transform 而不是 React 内联 style：
 * 应用 CSP 不允许行内 style，只能通过 el.style 直接写入。
 */

/** 长按多久后进入拖动（毫秒），需与 CSS 进度条动画时长一致 */
const LONG_PRESS_MS = 1000;
/** 长按期间允许的抖动范围，超出即视为滚动，放弃长按 */
const MOVE_TOLERANCE_PX = 8;
/** 让位动画时长，需与 CSS 中的过渡保持一致 */
const SHIFT_MS = 160;
/** 拖到距容器边缘多少像素内开始自动滚动 */
const AUTO_SCROLL_EDGE_PX = 56;
/** 自动滚动的最大速度（像素/帧） */
const AUTO_SCROLL_MAX_STEP = 14;

interface ItemSnapshot {
  id: string;
  el: HTMLElement;
  /** 拖动开始时相对视口的顶部位置 */
  top: number;
  height: number;
}

interface PressState {
  id: string;
  /** 是否触屏（决定用 touch 还是 pointer 事件跟踪） */
  isTouch: boolean;
  x: number;
  y: number;
  listEl: HTMLElement;
  /** 被按住的卡片元素（用于显示长按进度条） */
  el: HTMLElement;
}

interface DragState {
  id: string;
  isTouch: boolean;
  /** 按下时的视口 Y 坐标，用于计算拖动位移 */
  startY: number;
  items: ItemSnapshot[];
  startIndex: number;
  /** 目标插入位置（在「移除被拖项」后的数组中的下标） */
  targetIndex: number;
  /** 列表项之间的实际 gap（像素），用于计算让位位移与指示线位置 */
  gap: number;
  /** 被拖卡片允许的最小位移（负数，向上到底） */
  minDelta: number;
  /** 被拖卡片允许的最大位移（正数，向下到底） */
  maxDelta: number;
  /** 承载本次拖动的列表容器（用于加/去 data-sorting 属性） */
  listEl: HTMLElement;
  /** 可滚动的祖先容器（自动滚动用），无则为 null */
  scrollEl: HTMLElement | null;
  /** 拖动开始时的滚动位置，用于换算卡片在视口中的实际位置 */
  startScrollTop: number;
  /** 最近一次指针的视口 Y 坐标（自动滚动循环读取） */
  lastY: number;
  /** 是否真的拖动过（用于区分「长按后原地松手」与「拖动后松手」） */
  moved: boolean;
  /** 是否已执行过一次让位布局（首帧必须布局，之后按需） */
  laidOut: boolean;
  /** 自动滚动的 rAF 句柄 */
  rafId: number | null;
  /** 合并高频 move 事件的 rAF 句柄 */
  frameId: number | null;
}

interface Options {
  /** 是否允许拖动（搜索/筛选状态下顺序无意义，应关闭） */
  enabled: boolean;
  /** 提交新顺序：传入该列表内按目标顺序排列的 id */
  onCommit: (ids: string[]) => void;
}

/** 向上查找第一个可纵向滚动的祖先 */
function findScrollParent(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node) {
    const style = window.getComputedStyle(node);
    const oy = style.overflowY;
    if ((oy === "auto" || oy === "scroll") && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

export function useDragSort({ enabled, onCommit }: Options) {
  const dragRef = useRef<DragState | null>(null);
  const pressRef = useRef<PressState | null>(null);
  const timerRef = useRef<number | null>(null);
  const swallowTimerRef = useRef<number | null>(null);
  const commitRef = useRef(onCommit);
  const enabledRef = useRef(enabled);
  /** 自动滚动循环：由处理器初始化块赋值，onPointerDown 启动 */
  const autoScrollRef = useRef<(() => void) | null>(null);
  /** 事件处理器集合：用 ref 持有，避免 useCallback 之间的循环依赖 */
  const handlersRef = useRef<{
    touchMove: (e: TouchEvent) => void;
    touchEnd: () => void;
    touchCancel: () => void;
    mouseMove: (e: PointerEvent) => void;
    mouseUp: () => void;
    context: (e: Event) => void;
  } | null>(null);

  useEffect(() => {
    commitRef.current = onCommit;
  }, [onCommit]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  /** 撤掉长按进度条并清掉定时器 */
  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const press = pressRef.current;
    if (press) press.el.removeAttribute("data-pressing");
  }, []);

  const detach = useCallback(() => {
    const h = handlersRef.current;
    if (!h) return;
    document.removeEventListener("touchmove", h.touchMove);
    document.removeEventListener("touchend", h.touchEnd);
    document.removeEventListener("touchcancel", h.touchCancel);
    document.removeEventListener("pointermove", h.mouseMove);
    document.removeEventListener("pointerup", h.mouseUp);
    document.removeEventListener("contextmenu", h.context);
  }, []);

  /** 放弃长按（未进入拖动）：撤进度条、清状态、解绑监听 */
  const cancelPress = useCallback(() => {
    clearTimer();
    pressRef.current = null;
    detach();
  }, [clearTimer, detach]);

  /** 还原所有被拖动改写的行内样式 */
  const resetItems = useCallback((st: DragState) => {
    // 先关掉过渡再清 transform：DOM 顺序此时已改成最终顺序，
    // 若让 transform 走过渡，卡片会从「旧位置 + 旧位移」滑到新位置，
    // 表现为松手后整列抖一下。关掉过渡后清 transform 是瞬时归位。
    for (const it of st.items) {
      it.el.style.transition = "none";
      it.el.style.removeProperty("transform");
      it.el.style.removeProperty("z-index");
      it.el.removeAttribute("data-dragging");
    }
    // 强制回流，确保上面的 transition: none 已生效
    void st.listEl.offsetHeight;
    for (const it of st.items) {
      it.el.style.removeProperty("transition");
    }
    st.listEl.removeAttribute("data-sorting");
    st.listEl.style.removeProperty("touch-action");
    // 移除落点指示线
    st.listEl.querySelector(".otp-drop-line")?.remove();
    setDragLock(false);
  }, []);

  /** 结束拖动；commit 为 true 时提交新顺序 */
  const finish = useCallback(
    (commit: boolean) => {
      const st = dragRef.current;
      dragRef.current = null;
      // 先 clearTimer 再清 pressRef：clearTimer 需要读 pressRef 来撤掉进度条
      clearTimer();
      pressRef.current = null;
      detach();
      if (!st) return;

      const order = st.items.map((i) => i.id);
      order.splice(st.startIndex, 1);
      order.splice(st.targetIndex, 0, st.id);
      const changed = order.some((id, i) => id !== st.items[i].id);

      if (st.rafId !== null) {
        window.cancelAnimationFrame(st.rafId);
        st.rafId = null;
      }
      if (st.frameId !== null) {
        window.cancelAnimationFrame(st.frameId);
        st.frameId = null;
      }
      // 清掉 transform 与让位位移。调用方（onCommit）会在同一事件循环内
      // 同步更新列表顺序，React 在本次绘制前完成重排，因此不会出现
      // 「先弹回原位、下一帧再跳过去」的闪动。
      resetItems(st);

      // 只有真的拖动过才吞掉随后的 click。
      // 长按后原地松手（用户只是想看看、或误触）应保持「点击复制」的原有行为，
      // 否则会变成「长按一下就没反应」。
      if (st.moved) {
        const swallow = (ev: Event) => {
          ev.stopPropagation();
          ev.preventDefault();
          st.listEl.removeEventListener("click", swallow, true);
          if (swallowTimerRef.current !== null) {
            window.clearTimeout(swallowTimerRef.current);
            swallowTimerRef.current = null;
          }
        };
        st.listEl.addEventListener("click", swallow, true);
        swallowTimerRef.current = window.setTimeout(() => {
          st.listEl.removeEventListener("click", swallow, true);
          swallowTimerRef.current = null;
        }, 600);
      }

      if (!commit) return;
      // 顺序没变就不写库，避免无意义的一次加密落盘
      if (changed) {
        commitRef.current(order);
      }
    },
    [clearTimer, detach, resetItems],
  );

  /** 进入拖动状态 */
  const startDrag = useCallback(
    (press: PressState) => {
      const els = Array.from(press.listEl.querySelectorAll<HTMLElement>("[data-sort-id]"));
      if (els.length < 2) {
        cancelPress();
        return;
      }
      const items: ItemSnapshot[] = [];
      for (const el of els) {
        const id = el.dataset.sortId;
        if (!id) continue;
        const rect = el.getBoundingClientRect();
        items.push({ id, el, top: rect.top, height: rect.height });
      }
      const startIndex = items.findIndex((i) => i.id === press.id);
      if (startIndex < 0) {
        cancelPress();
        return;
      }
      // 实际 gap：用「相邻顶部差 - 前一项高度」推算，比读 computedStyle 稳
      const gap =
        items.length > 1 ? Math.max(0, items[1].top - (items[0].top + items[0].height)) : 12;
      const scrollEl = findScrollParent(press.listEl);

      // 位移边界：被拖卡片只能在「第一项顶部」到「最后一项底部」之间移动。
      // 不加限制时卡片会一直跟着指针跑出列表，甚至跑到窗口外（用户看到的
      // 「能一直往下拖」）。边界按卡片自身高度换算成相对起始位置的位移量。
      const draggedItem = items[startIndex];
      const firstTop = items[0].top;
      const lastItem = items[items.length - 1];
      const lastBottom = lastItem.top + lastItem.height;
      const minDelta = firstTop - draggedItem.top;
      const maxDelta = lastBottom - (draggedItem.top + draggedItem.height);

      dragRef.current = {
        id: press.id,
        isTouch: press.isTouch,
        startY: press.y,
        items,
        startIndex,
        targetIndex: startIndex,
        gap,
        minDelta,
        maxDelta,
        listEl: press.listEl,
        scrollEl,
        startScrollTop: scrollEl ? scrollEl.scrollTop : 0,
        lastY: press.y,
        moved: false,
        laidOut: false,
        rafId: null,
        frameId: null,
      };

      // 进度条已完成使命，撤掉
      press.el.removeAttribute("data-pressing");

      const dragged = items[startIndex];
      dragged.el.setAttribute("data-dragging", "");
      dragged.el.style.zIndex = "20";
      press.listEl.setAttribute("data-sorting", "");
      // 触屏：拖动期间禁止浏览器接管手势（配合 touchmove 的 preventDefault）
      if (press.isTouch) press.listEl.style.touchAction = "none";
      // 暂停验证码轮询：避免每秒重渲染拖慢拖动
      setDragLock(true);
      for (const it of items) {
        if (it === dragged) continue;
        it.el.style.transition = `transform ${SHIFT_MS}ms cubic-bezier(0.2, 0, 0.2, 1)`;
      }
    },
    [cancelPress],
  );

  // 处理器只创建一次，内部通过 ref 读取最新状态
  if (!handlersRef.current) {
    /**
     * 更新落点指示线。
     *
     * 位置算法：target 表示「插入到第 target 个位置」（已排除被拖项）。
     * 指示线画在「让位后」的空隙处：
     * - target 在末尾：最后一项底部 + gap/2
     * - 否则：第 target 项顶部 - gap/2
     *
     * 注意参照项要用「让位后的位置」：被拖项之后的卡片已经上移了
     * shiftAmount，若仍用原始快照坐标，指示线会画在错误的位置。
     */
    const updateIndicator = (st: DragState, target: number, scrollDelta: number) => {
      let line = st.listEl.querySelector<HTMLElement>(".otp-drop-line");
      if (!line) {
        line = document.createElement("div");
        line.className = "otp-drop-line";
        st.listEl.appendChild(line);
      }
      const others = st.items.filter((_, i) => i !== st.startIndex);
      if (others.length === 0) return;

      const dragged = st.items[st.startIndex];
      const shiftAmount = dragged.height + st.gap;
      // 让位后，原 startIndex 之后的卡片整体上移 shiftAmount
      const shiftedTop = (origIndex: number) =>
        st.items[origIndex].top - (origIndex > st.startIndex ? shiftAmount : 0);

      let y: number;
      if (target >= others.length) {
        // 插到末尾：最后一项（原始索引为 items.length-1）底部
        const lastOrig = st.items.length - 1;
        const last = st.items[lastOrig];
        y = shiftedTop(lastOrig) + last.height - scrollDelta + st.gap / 2;
      } else {
        // 插到第 target 项之前：找到该项的原始索引
        let seen = 0;
        let refOrig = -1;
        for (let i = 0; i < st.items.length; i++) {
          if (i === st.startIndex) continue;
          if (seen === target) {
            refOrig = i;
            break;
          }
          seen += 1;
        }
        if (refOrig < 0) return;
        y = shiftedTop(refOrig) - scrollDelta - st.gap / 2;
      }
      // 换算成相对列表容器的坐标（列表可能有 padding / 自身偏移）
      const listRect = st.listEl.getBoundingClientRect();
      line.style.top = `${y - listRect.top}px`;
    };

    /**
     * 按当前指针位置重算所有卡片的位置。
     *
     * 卡片快照记录的是拖动开始时的视口坐标，容器滚动后需要减去滚动增量，
     * 否则自动滚动时「让位」会算错位置。
     *
     * 性能要点：只写「值有变化」的 transform。触摸设备一次滑动每秒可产生
     * 60~120 个 touchmove，若每次都无条件写全部卡片的 transform，
     * 会触发大量无意义的样式重算，表现为拖动发涩。
     */
    const layout = (st: DragState) => {
      const scrollDelta = st.scrollEl ? st.scrollEl.scrollTop - st.startScrollTop : 0;
      const dragged = st.items[st.startIndex];
      // 位移必须夹在列表范围内：不加限制时卡片会一直跟着指针跑出列表，
      // 甚至跑到窗口外（表现为「能一直往下拖」）。
      // 滚动增量也要计入，否则自动滚动时卡片会脱离手指。
      const raw = st.lastY - st.startY + scrollDelta;
      const delta = Math.min(st.maxDelta, Math.max(st.minDelta, raw));
      // 容器滚动会让卡片在视口中上移，因此位移要补上滚动增量，
      // 卡片才会始终跟着手指走
      dragged.el.style.transform = `translateY(${delta}px) scale(1.02)`;

      // 用「手指位置」而非「被拖卡片中心」判断落点。
      //
      // 为什么：用户通常按在卡片上部，卡片中心远低于手指。若用卡片中心判定，
      // 落点会明显滞后于手指，表现为「想插到两个元素中间却插不进去」。
      // 手指位置才是用户心里的「插入点」。
      const pointerY = st.lastY;
      let target = 0;
      for (let i = 0; i < st.items.length; i++) {
        if (i === st.startIndex) continue;
        const it = st.items[i];
        // 参照项中心（换算到当前视口）
        const center = it.top - scrollDelta + it.height / 2;
        if (center < pointerY) target += 1;
      }

      // 落点指示线：始终跟随目标位置，让用户清楚「松手会插到这里」。
      // 这是解决「不知道会落到哪」的关键——只靠卡片让位，视觉空位与
      // 实际落点容易错位（卡片高度不一致时尤其明显）。
      updateIndicator(st, target, scrollDelta);

      // 目标位置没变就不必重写其余卡片（绝大多数 move 事件都属于这种情况）
      if (target === st.targetIndex && st.laidOut) return;
      st.targetIndex = target;
      st.laidOut = true;

      // 其余卡片让位。
      // 位移量取「被拖卡片高度 + gap」而不是统一的 step：
      // 卡片高度并不一致（紧凑/标准密度、不同详情程度），
      // 用统一步长会让视觉空位与实际落点错开，表现为「插不进去」。
      const shiftAmount = dragged.height + st.gap;
      for (let i = 0; i < st.items.length; i++) {
        if (i === st.startIndex) continue;
        const it = st.items[i];
        let shift = 0;
        if (i > st.startIndex && i <= target) shift = -shiftAmount;
        else if (i < st.startIndex && i >= target) shift = shiftAmount;
        it.el.style.transform = shift === 0 ? "" : `translateY(${shift}px)`;
      }
    };

    /** 拖到容器上下边缘时自动滚动，让长列表也能跨屏排序 */
    const autoScroll = () => {
      const st = dragRef.current;
      if (!st) return;
      const el = st.scrollEl;
      if (el) {
        const rect = el.getBoundingClientRect();
        const y = st.lastY;
        let dy = 0;
        if (y < rect.top + AUTO_SCROLL_EDGE_PX) {
          const ratio = (rect.top + AUTO_SCROLL_EDGE_PX - y) / AUTO_SCROLL_EDGE_PX;
          dy = -Math.ceil(Math.min(1, ratio) * AUTO_SCROLL_MAX_STEP);
        } else if (y > rect.bottom - AUTO_SCROLL_EDGE_PX) {
          const ratio = (y - (rect.bottom - AUTO_SCROLL_EDGE_PX)) / AUTO_SCROLL_EDGE_PX;
          dy = Math.ceil(Math.min(1, ratio) * AUTO_SCROLL_MAX_STEP);
        }
        if (dy !== 0) {
          const before = el.scrollTop;
          el.scrollTop = before + dy;
          if (el.scrollTop !== before) {
            st.moved = true;
            layout(st);
          }
        }
      }
      st.rafId = window.requestAnimationFrame(autoScroll);
    };
    autoScrollRef.current = autoScroll;

    /**
     * 用 rAF 合并高频 move 事件。
     *
     * 触摸设备一次滑动每秒可产生 60~120 个 touchmove，而屏幕刷新只有 60Hz。
     * 若每个事件都同步写 transform，一帧内会重复布局多次，纯属浪费，
     * 表现为拖动发涩。这里只记录最新坐标，真正的布局交给下一帧。
     */
    const scheduleLayout = (st: DragState) => {
      if (st.frameId !== null) return;
      st.frameId = window.requestAnimationFrame(() => {
        const cur = dragRef.current;
        if (!cur) return;
        cur.frameId = null;
        layout(cur);
      });
    };

    handlersRef.current = {
      touchMove: (ev: TouchEvent) => {
        const touch = ev.touches[0];
        if (!touch) return;
        const st = dragRef.current;
        if (st) {
          // 拖动中：必须阻止默认行为，否则浏览器会接管手势并发出
          // touchcancel，拖动被强行中断（这正是「有时能拖、有时不能」的根因）
          if (ev.cancelable) ev.preventDefault();
          st.lastY = touch.clientY;
          if (Math.abs(touch.clientY - st.startY) > 2) st.moved = true;
          scheduleLayout(st);
          return;
        }
        const press = pressRef.current;
        if (!press) return;
        // 长按期间滑动：视为滚动列表，放弃长按
        if (
          Math.abs(touch.clientY - press.y) > MOVE_TOLERANCE_PX ||
          Math.abs(touch.clientX - press.x) > MOVE_TOLERANCE_PX
        ) {
          cancelPress();
        }
      },
      touchEnd: () => {
        if (dragRef.current) {
          finish(true);
          return;
        }
        cancelPress();
      },
      touchCancel: () => {
        // 拖动中收到 touchcancel：浏览器仍接管了手势。
        // 此时按当前位置提交，而不是丢弃用户已经完成的拖动。
        if (dragRef.current) {
          finish(true);
          return;
        }
        cancelPress();
      },
      mouseMove: (e: PointerEvent) => {
        const st = dragRef.current;
        if (st) {
          st.lastY = e.clientY;
          if (Math.abs(e.clientY - st.startY) > 2) st.moved = true;
          scheduleLayout(st);
          return;
        }
        const press = pressRef.current;
        if (!press) return;
        // 长按期间移动：与触屏一致，放弃长按
        if (
          Math.abs(e.clientY - press.y) > MOVE_TOLERANCE_PX ||
          Math.abs(e.clientX - press.x) > MOVE_TOLERANCE_PX
        ) {
          cancelPress();
        }
      },
      mouseUp: () => {
        if (dragRef.current) {
          finish(true);
          return;
        }
        cancelPress();
      },
      context: (ev: Event) => {
        // 长按期间与拖动中都屏蔽系统菜单（桌面右键 / 移动端长按菜单）
        if (pressRef.current || dragRef.current) ev.preventDefault();
      },
    };
  }

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!enabledRef.current) return;
      // 鼠标只响应左键
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // 卡片内的按钮（「更多」等）不参与拖动
      if (target.closest("button")) return;
      const itemEl = target.closest<HTMLElement>("[data-sort-id]");
      if (!itemEl) return;
      const listEl = itemEl.closest<HTMLElement>("[data-sort-list]");
      if (!listEl) return;
      const id = itemEl.dataset.sortId;
      if (!id) return;

      // 清理上一次可能残留的状态（先清再设，避免误删新进度条）
      clearTimer();
      pressRef.current = null;

      const isTouch = e.pointerType !== "mouse";
      pressRef.current = {
        id,
        isTouch,
        x: e.clientX,
        y: e.clientY,
        listEl,
        el: itemEl,
      };

      // 长按进度条：桌面端与移动端完全一致，1 秒填满即进入拖动
      itemEl.setAttribute("data-pressing", "");
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        const press = pressRef.current;
        if (!press) return;
        startDrag(press);
        // 进入拖动后启动自动滚动循环（拖到边缘时持续滚动）
        const st = dragRef.current;
        if (st && autoScrollRef.current) {
          st.rafId = window.requestAnimationFrame(autoScrollRef.current);
        }
      }, LONG_PRESS_MS);

      const h = handlersRef.current;
      if (!h) return;
      // 监听必须在按下时就注册：等到长按成功再注册会错过第一个
      // touchmove，浏览器已经接管手势，拖动会被取消。
      if (isTouch) {
        document.addEventListener("touchmove", h.touchMove, { passive: false });
        document.addEventListener("touchend", h.touchEnd);
        document.addEventListener("touchcancel", h.touchCancel);
      } else {
        document.addEventListener("pointermove", h.mouseMove);
        document.addEventListener("pointerup", h.mouseUp);
      }
      document.addEventListener("contextmenu", h.context);
    },
    [clearTimer, startDrag],
  );

  // 组件卸载时清理残留监听与定时器
  useEffect(() => {
    return () => {
      clearTimer();
      if (swallowTimerRef.current !== null) window.clearTimeout(swallowTimerRef.current);
      const st = dragRef.current;
      if (st?.rafId != null) window.cancelAnimationFrame(st.rafId);
      if (st?.frameId != null) window.cancelAnimationFrame(st.frameId);
      detach();
    };
  }, [clearTimer, detach]);

  return { onPointerDown };
}
