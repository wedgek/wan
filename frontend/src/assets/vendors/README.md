# 厂商 Logo（SVG）

模型目录、模型商店等页面的厂商徽标，存放在本目录。页面通过 `VendorBadge` 组件 + `src/utils/vendorBrand.js` 按厂商名加载对应 SVG。

## 如何更新 Logo

需要批量刷新或新增厂商图标时，**不要手改 SVG**，运行拉取脚本即可：

```bash
cd frontend
npm run fetch:vendor-logos
```

在仓库根目录也可以（效果相同）：

```bash
npm run fetch:vendor-logos -w frontend
```

脚本会把 SVG 写入 **`frontend/src/assets/vendors/`**，覆盖同名文件。执行后刷新页面即可看到新图标，无需改后端。

## 脚本说明

- **脚本路径**：`frontend/scripts/fetch-vendor-logos.cjs`
- **不依赖** `simple-icons` 等 npm 包，运行时直接从 CDN 下载
- **拉取优先级**：
  1. 本地写死的多色矢量（Google 四色 G、OpenAI knot）
  2. [Lobe Icons](https://lobehub.com/icons) **`-color` 彩色版**（MIT）— 主要来源
  3. Lobe 单色版 + 脚本内品牌色替换（`-color` 不存在时）
  4. [Simple Icons](https://simpleicons.org/) CDN（MIT）— Lobe 无覆盖时（如小米）
  5. 字标回退 — 「免费模型」「其他」等无品牌源时使用

> **说明**：Lobe 单色 SVG 使用 `fill="currentColor"`，作为 `<img>` 加载会变成黑色；脚本会自动优先拉彩色版或写入品牌 hex 色。

## 新增厂商

1. 在 `fetch-vendor-logos.cjs` 的 `LOBE_MAP` 或 `SI_MAP` 里增加「文件名 → CDN slug」映射（文件名与 `vendorBrand.js` 里 `logo` 字段一致）
2. 在 `src/utils/vendorBrand.js` 的 `VENDOR_BRANDS` / `ALIASES` 里补充厂商配置
3. 执行 `npm run fetch:vendor-logos` 生成 SVG

Lobe slug 可在 [lobehub.com/icons](https://lobehub.com/icons) 搜索；Simple Icons slug 见 [simpleicons.org](https://simpleicons.org/)。

## 特殊映射（备忘）

| 文件名 | 实际品牌源 | 说明 |
|--------|-----------|------|
| `doubao.svg` | Lobe `doubao` | 豆包官方 logo |
| `kuaishou.svg` | Lobe `kling` | 快手视频模型用 Kling 品牌 |
| `iflytek.svg` | Lobe `iflytekcloud` | 讯飞开放平台 logo |
| `free.svg` / `default.svg` | 字标 | 无统一品牌 SVG |

## 许可证

Lobe Icons、Simple Icons 均为 **MIT**。Google / OpenAI 多色版本为项目内维护的矢量，仅供 UI 展示。
