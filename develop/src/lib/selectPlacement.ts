/**
 * 下拉浮层的展开方向判定（纯函数，便于测试）。
 *
 * 背景：设置页的控件位于滚动容器内，向下展开的浮层会被容器或窗口底部裁切，
 * 表现为「点开了但看不到选项」。空间不足时改为向上弹。
 *
 * 判定不追求最优解，只保证「能看见」：
 * - 下方够放 → 向下（默认方向，符合直觉）
 * - 下方不够放、且上方更宽裕 → 向上
 * - 上下都不够 → 选更宽裕的一侧
 */

/** 浮层与触发器之间留出的间距（px），与 CSS 中 `calc(100% + 6px)` 保持一致 */
export const PLACEMENT_GAP = 6;

/**
 * 估算浮层高度。
 *
 * 每项约 30px（含内边距与行高），容器上下 padding 共 10px，
 * 并与 CSS 的 `max-height: 320px` 对齐——不为了测量去渲染一次浮层。
 */
export function estimateDropdownHeight(optionCount: number): number {
  return Math.min(Math.max(optionCount, 1) * 30 + 10, 320);
}

export interface PlacementInput {
  /** 触发器上边缘（getBoundingClientRect().top） */
  triggerTop: number;
  /** 触发器下边缘（getBoundingClientRect().bottom） */
  triggerBottom: number;
  /** 估算的浮层高度 */
  dropdownHeight: number;
  /** 视口高度 */
  viewportHeight: number;
}

/** 是否应该向上展开 */
export function shouldDropup(input: PlacementInput): boolean {
  const { triggerTop, triggerBottom, dropdownHeight, viewportHeight } = input;
  // 上下各留出间距，避免浮层贴边
  const spaceBelow = viewportHeight - triggerBottom - PLACEMENT_GAP - 2;
  const spaceAbove = triggerTop - PLACEMENT_GAP - 2;
  if (spaceBelow >= dropdownHeight) return false;
  // 下方放不下：只有在下方更局促时才向上，否则维持向下（可能出现滚动，但不遮挡触发器）
  return spaceAbove > spaceBelow;
}

/** 浮层的水平对齐方式：ghost 变体右对齐，默认变体左对齐 */
export function dropdownHorizontalStyle(
  variant: "default" | "ghost",
  triggerLeft: number,
  triggerRight: number,
  viewportWidth: number,
): { left?: number; right?: number } {
  if (variant === "ghost") {
    // 右对齐到触发器右边缘，且不超出视口
    const right = Math.max(viewportWidth - triggerRight, 8);
    return { right };
  }
  const left = Math.min(Math.max(triggerLeft, 8), Math.max(viewportWidth - 260, 8));
  return { left };
}
