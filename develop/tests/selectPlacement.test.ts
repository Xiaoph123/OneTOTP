/**
 * 下拉浮层展开方向判定的单元测试。
 *
 * 直接跑：npm test（Node 24 原生 TypeScript，无需额外依赖）
 *
 * 覆盖的是真实踩过的坑：设置项位于页面底部时，向下展开的浮层被滚动容器
 * 或窗口底部裁切，表现为「点开了却没有选项」。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  PLACEMENT_GAP,
  dropdownHorizontalStyle,
  estimateDropdownHeight,
  shouldDropup,
} from "../src/lib/selectPlacement.ts";

describe("estimateDropdownHeight", () => {
  test("按项数估算，并封顶 320px（与 CSS max-height 一致）", () => {
    assert.equal(estimateDropdownHeight(1), 40);
    assert.equal(estimateDropdownHeight(3), 100);
    assert.equal(estimateDropdownHeight(20), 320);
    // 0 项时也要给出正高度，避免判定除零式的边界问题
    assert.ok(estimateDropdownHeight(0) > 0);
  });
});

describe("shouldDropup", () => {
  test("下方空间充足 → 向下展开", () => {
    assert.equal(
      shouldDropup({
        triggerTop: 100,
        triggerBottom: 140,
        dropdownHeight: 100,
        viewportHeight: 800,
      }),
      false,
    );
  });

  test("页面底部、上方宽裕 → 向上展开", () => {
    assert.equal(
      shouldDropup({
        triggerTop: 700,
        triggerBottom: 740,
        dropdownHeight: 100,
        viewportHeight: 800,
      }),
      true,
    );
  });

  test("下方放不下但上方更局促 → 仍向下（允许滚动，不遮挡触发器）", () => {
    assert.equal(
      shouldDropup({
        triggerTop: 60,
        triggerBottom: 100,
        dropdownHeight: 320,
        viewportHeight: 200,
      }),
      false,
    );
  });

  test("上下都不够时选更宽裕的一侧", () => {
    // 下方 40px，上方 300px → 向上
    assert.equal(
      shouldDropup({
        triggerTop: 320,
        triggerBottom: 360,
        dropdownHeight: 300,
        viewportHeight: 400,
      }),
      true,
    );
  });

  test("刚好等于可用空间时仍向下（边界不抖动）", () => {
    const dropdownHeight = 100;
    const viewportHeight = 800;
    const triggerBottom = viewportHeight - PLACEMENT_GAP - 2 - dropdownHeight;
    assert.equal(
      shouldDropup({ triggerTop: triggerBottom - 40, triggerBottom, dropdownHeight, viewportHeight }),
      false,
    );
  });
});

describe("dropdownHorizontalStyle", () => {
  test("ghost 变体右对齐到触发器右边缘", () => {
    const style = dropdownHorizontalStyle("ghost", 200, 320, 400);
    assert.equal(style.right, 80);
    assert.equal(style.left, undefined);
  });

  test("ghost 变体贴近右边缘时保留最小边距", () => {
    const style = dropdownHorizontalStyle("ghost", 350, 400, 400);
    assert.equal(style.right, 8);
  });

  test("默认变体左对齐，且不超出视口", () => {
    assert.equal(dropdownHorizontalStyle("default", 20, 100, 400).left, 20);
    // 靠近右边缘时夹到视口内（预留浮层最大宽度 260）
    assert.equal(dropdownHorizontalStyle("default", 380, 460, 400).left, Math.max(400 - 260, 8));
  });
});
