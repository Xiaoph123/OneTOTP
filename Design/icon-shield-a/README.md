# OneTotp 图标 · 柔光渐变盾（方案 A）

> 颜色**全部取自你项目里的色阶**，没有一个是自造色值。文件落在新增目录，未改动任何代码。

---

## 1. 这一版和上一版的区别

上一版（方案 A 初稿）的问题就是颜色：渐变两端我自己往外扩了色（`#5E96FF` / `#0A38A8`），跑出了你的色阶。
这一版把渐变**收回 `tokens.css` 的 `--primary-1 ~ --primary-8`**，色阶上的每一档都是你的原始值，一格不多一格不少。

| | 上一版 | 这一版 |
| --- | --- | --- |
| 渐变亮部 | `#5E96FF`（自造） | `#6E9FFF` = **`--primary-4`** |
| 渐变中点 | `#1664FF` = `--primary-6` | `#1664FF` = **`--primary-6`**（品牌主色） |
| 渐变暗部 | `#0A38A8`（自造） | `#114AB9` = **`--primary-8`** |
| 暗色版亮部 | `#D3E3FF`（自造） | `#97BCFF` = **`--primary-3`** |
| 暗色版中点 | `#7FA8FF`（自造） | `#6F9DFF` = **暗色主题 `--color-on-primary-container`** |
| 暗色版暗部 | `#3F63BE`（自造） | `#387BFF` = **`--primary-5`** |

---

## 2. 主推：`a1-standard`

![主推亮色](preview/oneTotp-shield-a1-standard-light-256.png)
![主推暗色](preview/oneTotp-shield-a1-standard-dark-256.png)

**为什么选中调**：渐变的中点（55% 位置）正好压在品牌主色 `#1664FF` 上——盾牌上最大面积的那块颜色，就是 OneTotp 的主色本身。亮部与暗部各往外走两档，形成一个完整但不夸张的明度跨度。

### 亮色版（用在浅色界面）

| 层 | 颜色 | 来源 |
| --- | --- | --- |
| 盾体渐变 0% | `#6E9FFF` | `--primary-4` |
| 盾体渐变 55% | `#1664FF` | **`--primary-6` / `--color-primary`** |
| 盾体渐变 100% | `#114AB9` | `--primary-8` |
| 左上柔光 | 白色，32% → 0 的径向渐变 | — |
| 底部柔和投影 | `#114AB9` 36%，`feGaussianBlur stdDeviation=26`，下移 26px | `--primary-8` |
| 笔画 1 | `#FFFFFF`，笔画投影 `#114AB9` 32%，下移 12px | `--color-white` |

### 暗色版（用在深色界面）

暗色版**不是把亮色版压暗**，而是把取色整体上移到色阶的亮端，保证在深色任务栏上能立住：

| 层 | 颜色 | 来源 |
| --- | --- | --- |
| 盾体渐变 0% | `#97BCFF` | `--primary-3` |
| 盾体渐变 55% | `#6F9DFF` | 暗色主题 `--color-on-primary-container` |
| 盾体渐变 100% | `#387BFF` | `--primary-5` |
| 左上柔光 | 白色，34% → 0 | — |
| 底部柔和投影 | 黑色 50% | — |
| 笔画 1 | `#FFFFFF` | `--color-white` |

---

## 3. 另两档色调（同一套逻辑，取色阶上不同的三段）

改色调只需替换三个 stop-color，几何、柔光、投影、笔画全都跟着走。

| 色调 | 亮色版渐变 | 暗色版渐变 | 观感 |
| --- | --- | --- | --- |
| **a2-deep 深邃** | `#387BFF` → `#1759DD` → `#114AB9`<br>（p5 → p7 → p8） | `#6F9DFF` → `#387BFF` → `#1759DD` | 更沉、更"安全"，适合偏严肃的定位 |
| **a3-light 轻盈** | `#97BCFF` → `#387BFF` → `#1664FF`<br>（p3 → p5 → p6） | `#EBF1FF` → `#97BCFF` → `#6F9DFF` | 更亮更轻，适合偏清爽的定位 |

![a2 深邃](preview/oneTotp-shield-a2-deep-light-256.png)
![a3 轻盈](preview/oneTotp-shield-a3-light-light-256.png)

三档都完整生成，改主意只要换个文件名即可。

---

## 4. 用到的完整色阶

| Token | 色值 | 在本设计里 |
| --- | --- | --- |
| `--primary-1` | `#F3F7FF` | 未使用 |
| `--primary-2` | `#EBF1FF` | 仅 a3 暗色版亮部 |
| `--primary-3` | `#97BCFF` | 暗色版亮部 / a3 亮部 |
| `--primary-4` | `#6E9FFF` | **主推亮色版亮部** |
| `--primary-5` | `#387BFF` | 暗色版暗部 / a2、a3 |
| `--primary-6` | `#1664FF` | **主推渐变中点（品牌主色）** |
| `--primary-7` | `#1759DD` | a2 深邃中点 |
| `--primary-8` | `#114AB9` | **主推暗部 + 投影色** |
| 暗色主题 `--color-on-primary-container` | `#6F9DFF` | 暗色版中点 |
| `--color-white` | `#FFFFFF` | 柔光与笔画 |

---

## 5. 文件清单

```
Design/icon-shield-a/
├─ preview.html                            ← 浏览器打开：三档色调 × 尺寸 × 目标背景 + 色阶对照
│
├─ oneTotp-icon-light.svg                  ← 应用图标版 · 亮色（标识放大到画布约 60%）
├─ oneTotp-icon-dark.svg                   ← 应用图标版 · 暗色
│
├─ oneTotp-shield-a1-standard-light.svg    ← 主推 · 亮色
├─ oneTotp-shield-a1-standard-dark.svg     ← 主推 · 暗色
├─ oneTotp-shield-a2-deep-light.svg        ← 深邃 · 亮色
├─ oneTotp-shield-a2-deep-dark.svg         ← 深邃 · 暗色
├─ oneTotp-shield-a3-light-light.svg       ← 轻盈 · 亮色
├─ oneTotp-shield-a3-light-dark.svg        ← 轻盈 · 暗色
│
├─ preview/                                ← 各尺寸 PNG（48 张）
├─ tauri-light/                            ← 亮色版全套平台图标（52 个）
└─ tauri-dark/                             ← 暗色版全套平台图标（52 个）
```

`tauri-*` 内含 `.ico`（16/24/32/48/64/256 六个尺寸）、`.icns`、`128x128@2x.png`、Windows 磁贴 `Square*`、`StoreLogo`，以及 android / ios 全套。

**`-shield-*.svg` 与 `-icon-*.svg` 的区别**：前者是完整画布（盾牌占 50% 宽），适合做 Logo、插图、界面内使用；后者把标识放大到约 60% 宽，是给 `.ico` / `.icns` 这类"要被塞进 16px 的方格"用的。打包请用 `-icon-*.svg`。

---

## 6. 落地到应用里

`tauri.conf.json` 的 `bundle.icon` 引用的 5 个路径不用改：

```bash
# 先备份现有的默认图标（现在是 Tauri 默认的橙青色 Logo）
cp -r develop/src-tauri/icons develop/src-tauri/icons.bak

# 二选一：亮色版 / 暗色版
cp -r Design/icon-shield-a/tauri-light/* develop/src-tauri/icons/
# cp -r Design/icon-shield-a/tauri-dark/* develop/src-tauri/icons/
```

改完需要重新 `npm run tauri build` 才会打进安装包。

> `.ico` / `.icns` 是单文件，无法按主题切换，桌面上只能二选一。
> 想在**应用内**跟着 `<html data-theme>` 换色，把这两个 SVG 放进前端资源即可——那部分要改代码，我没有动。

---

## 7. 想继续调颜色，改这几个数就够

| 想改什么 | 改哪里 |
| --- | --- |
| 整体色调（深/中/浅） | `bd` 渐变的三个 `stop-color`，从色阶里挑三段即可 |
| 渐变方向 | `linearGradient` 的 `x1/y1 → x2/y2`（当前是左上到右下） |
| 高光强度 | `radialGradient` 的第一个 `stop-opacity`（当前 0.32） |
| 高光位置 | `radialGradient` 的 `cx="0.3" cy="0.16"` |
| 投影深浅 / 柔度 | `fill-opacity`（0.36）与 `feGaussianBlur stdDeviation`（26） |
| 盾牌胖瘦高矮 | `SH` 里的 `w`(512) / `top`(198) / `bottom`(854) |
| 笔画粗细 | 两个笔画路径的 `stroke-width`(76) |

全部是 SVG 里的明文数字，未压缩、未转 path 化，直接手改即可。

---

## 8. 说明

- 新增目录：`Design/icon-shield-a/`（未被 Git 跟踪）
- 未改动任何源码：`develop/` 下的源文件、`tauri.conf.json`、`src-tauri/icons/` 均保持原样（已用文件指纹核对）
