# OneTotp 应用图标设计

> 本文档只描述设计产出。设计过程中**没有修改任何一行代码**，所有文件都在新增的 `Design/icon/` 目录下。

---

## 1. 一句话概念

**「1」站在倒计时环里。**

数字 **1** 是品牌首字（One），也是"一个应用收拢全部验证码"；
**环**是应用里最核心的那个控件 —— 验证码的倒计时环；
环上的**缺口**是时间在流逝，**圆头端点**和应用内 `strokeLinecap="round"` 同源。

![预览](preview/oneTotp-icon.png)

---

## 2. 设计推导：从你的代码里读到的三件事

| 观察 | 出处 | 如何进入图标 |
| --- | --- | --- |
| 品牌名 **OneTotp** = One + TOTP | `tauri.conf.json` → `productName` | 取 "One" 的 **1** 做主形 |
| 应用内唯一的图形签名是**倒计时环**：轨迹 + 圆头进度弧 + 中央剩余秒数 | [Controls.tsx](../../develop/src/components/Controls.tsx) `CountdownRing`：`radius=27`、`strokeWidth=5`、`strokeLinecap="round"`、`strokeDasharray/Offset` 随时间收缩 | 环 = 图标外圈；弧长收缩 → 图标上留一个 66° 缺口 |
| 主色是 **#1664FF**，圆角语言是 4/8/12/16px 的小圆角，整体是扁平、克制、明暗双主题的桌面工具 | [tokens.css](../../develop/src/styles/tokens.css) `--primary-6` / `--color-primary` / `--radius-*` | 容器用圆角方形 + 品牌蓝；造型一律几何落笔，不加拟物 |

被否掉的几个方向，以及否掉的原因：

| 方向 | 为什么不要 |
| --- | --- |
| 盾牌 / 挂锁 | 安全类应用的通用符号，Microsoft Authenticator、Bitwarden 等已占满，无法区分 OneTotp |
| 钥匙 | 与 1Password 等密码管理器撞车，且 OneTotp 管的是验证码不是密码 |
| 六刻度表盘 / 六个点 | 语义正确（6 位验证码），但 32px 以下变成一圈噪点，且像"设置"齿轮 |
| 只有 1、没有环 | 16px 下最清楚，但丢掉了"一次性、会过期"的核心语义 |
| 环形 + 剪影字母 O | "O"和"1"组合会读成"O1"，不是产品名 |

---

## 3. 造型规格（可直接用于设计交付）

画布 **1024 × 1024**，透明底，全部为几何路径，**不依赖任何字体**（换机器、换系统都不会变形）。

| 元素 | 规格 | 说明 |
| --- | --- | --- |
| 容器 | `896 × 896`，圆角 `200`（22.37%） | 距画布四周留白 64（6.25%），Windows / Linux / macOS 通用安全区 |
| 底色 | 线性渐变 `#4A86FF` → `#1664FF`(50%) → `#0E4CD4` | 中段即品牌主色 |
| 顶部高光 | 白色 14% → 0 的竖向渐变 | 避免大色块发闷，只在亮部加一层，不改变色相 |
| 倒计时环 | 圆心 (512,512)，半径 `322`，描边 `56`，圆头端点 | 描边/半径 = **0.174**，与应用内 `5/27 = 0.185` 同一量级，视觉同族 |
| 环缺口 | `66°`（占圆周 18.3%），缺口中心位于 **45°（右上）** | 右上开口最"透气"，小尺寸下不会被误读成断线 |
| 环轨迹 | 同一半径上再画一整圈，白色 **18%** | 对应应用内浅灰轨迹，让"已走过 / 未走过"两层信息保留下来 |
| 数字 1 | 笔画 `106`，旗与竖笔夹角 45°，高 `415`，底横半宽 `116` | 底横是关键：没有它，小尺寸下会被读成箭头或斜杠 |

### 数字 1 的路径（原始值）

```
M 375.56 440.94  L 512 357.5  L 512 666.5
M 396 666.5      L 628 666.5
```
`stroke-width="106"`、`stroke-linecap="round"`、`stroke-linejoin="round"`。

1 的外接范围是 x∈[325, 681]、y∈[304.5, 719.5]，与环内缘（半径 322−28=294，即距圆心 294）之间**最窄处仍有约 86 个单位留白**，因此任何尺寸下都不会与环粘连。

### macOS 版本

`oneTotp-icon-macos.svg` 按 Apple 规范把容器缩到 `824 × 824`、四周留白 `100`（9.8%），圆角按比例缩小，环与数字同步等比缩小。macOS 不会自动给图标加圆角，所以圆角方形必须画在图形里 —— 主图标已经是这个做法，mac 版只是把留白调到 Apple 的比例。

---

## 4. 色彩

| 色值 | 用途 | 来源 |
| --- | --- | --- |
| `#1664FF` | 图标主色（渐变色标 50%）、扁平版底色、浅底标识 | **tokens.css `--primary-6` / `--color-primary`** |
| `#4A86FF` | 渐变亮部 | 图标专用扩展（比 `--primary-5 #387BFF` 再亮一档） |
| `#0E4CD4` | 渐变暗部 | 图标专用扩展（比 `--primary-7 #1759DD` 再深一档） |
| `#FFFFFF` | 环、数字、高光 | `--color-white` |
| 白色 18% | 环轨迹 | 对应应用内 `--color-bg-5` 轨迹的图标化处理 |

> **为什么渐变两端跑出了色阶？**
> UI 色阶的亮度范围是给"面"用的（大块背景不能太跳）；图标要在一个 32px 的方块里自证体积，需要更大的明度跨度。所以只把渐变的两端各外扩一档，中间的 50% 锚点仍严格落在 `--primary-6` 上。
> 如果你的规范要求 100% 贴合 token，请直接用 `oneTotp-icon-flat.svg`（纯 `#1664FF` 实底，无渐变、无高光）。

---

## 5. 各尺寸实测

| 尺寸 | 用在哪 | 表现 |
| --- | --- | --- |
| 1024 / 512 / 256 | 安装包、应用商店、关于页 | 渐变、高光、环的圆头端点全部可见 |
| 128 / 64 / 48 | 桌面快捷方式、开始菜单磁贴 | 造型完整，"1"与环清晰分离 |
| **32** | Windows 任务栏 / 资源管理器 | 环与数字仍可分辨，是应用实际使用的最小尺寸 |
| **16** | 通知区、菜单项 | 主图标偏糊，改用 `oneTotp-icon-small.svg`（环加粗到 120、数字加粗到 150、缺口放大到 88°） |

所有尺寸都是同一份 SVG 等比缩放得到的，没有手工逐尺寸重画，因此后续修改只需改 SVG。

---

## 6. 文件清单

```
Design/icon/
├─ preview.html                    ← 用浏览器打开，看全部尺寸 + 任务栏实景模拟
├─ oneTotp-icon.svg                ← 主图标（1024，推荐使用）
├─ oneTotp-icon-flat.svg           ← 纯 token 扁平版（#1664FF 实底，无渐变）
├─ oneTotp-icon-small.svg          ← 小尺寸简化版（仅建议 ≤24px）
├─ oneTotp-icon-macos.svg          ← macOS 留白版
├─ oneTotp-mark.svg                ← 透明底标识，浅色背景用（品牌蓝）
├─ oneTotp-mark-white.svg          ← 透明底标识，深色背景用（纯白）
├─ preview/                        ← 各尺寸 PNG 预览（16 → 1024）
└─ tauri/                          ← 已生成好的全平台图标集
   ├─ 32x32.png  64x64.png  128x128.png  128x128@2x.png
   ├─ icon.png  icon.ico  icon.icns
   ├─ Square*Logo.png  StoreLogo.png     (Windows 磁贴/商店)
   ├─ android/                           (Android mipmap)
   └─ ios/                               (iOS AppIcon)
```

---

## 7. 如何落地到应用里

`tauri.conf.json` 里 `bundle.icon` 已经引用了 `icons/32x32.png`、`icons/128x128.png`、`icons/128x128@2x.png`、`icons/icon.icns`、`icons/icon.ico` 这 5 个文件，**配置不需要改动**，只要把这批图标放进 `develop/src-tauri/icons/` 即可。

推荐用 Tauri 官方生成器（这份 `tauri/` 目录就是这么生成的）：

```bash
# 在 develop/ 目录下执行
npx tauri icon ../Design/icon/oneTotp-icon.svg -o src-tauri/icons
```

或者直接把已生成好的文件复制过去：

```bash
# 以 Git Bash / PowerShell 为例，先看一眼要覆盖什么
cp -r Design/icon/tauri/* develop/src-tauri/icons/
```

> ⚠️ 当前 `develop/src-tauri/icons/` 里还是 **Tauri 默认的橙青色 Logo**（`icon.png` 是默认模板图），落地时会把这 14 个文件替换掉，建议先备份。
> 复制完成后需要重新 `npm run tauri build` 才会打进安装包；开发模式下（`npm run tauri dev`）任务栏图标也会随之更新。

---

## 8. 顺带发现的两处可选项（要不要用由你决定，我没有动代码）

1. `LockPage.tsx` 的锁定页头像 `.lock-avatar` 现在写死显示"王"字。这个位置本质是品牌位，换成 `oneTotp-mark-white.svg` 会更像产品本身；如果那是用户头像位，则保持现状更合适。
2. `TitleBar.tsx` 的标题栏只有文字 "OneTotp"。若希望窗口内也有品牌感，可在标题左侧加一个 16px 的 `oneTotp-mark.svg`（和应用内图标统一用 `currentColor` 描边的话，建议另做一版可换色的线性标识）。

---

## 9. 关于本次交付

- 新增目录：`Design/icon/`（未被 Git 跟踪的纯新增内容）
- 未改动任何源码：`develop/` 下的源文件、`tauri.conf.json`、`src-tauri/icons/` 均保持原样（已用文件指纹 + `git status` 双向核对）
- 图标内的所有几何路径都是我按品牌色与产品语义手写的，可无损缩放到任意尺寸；如果你要改颜色、改缺口角度、改笔画粗细，直接改 SVG 里的数字即可
