# UIUX — DeepSeek Harness 界面组件目录

这个目录是对 DeepSeek Harness Web 客户端全部 React UI 组件的调研产物：把每个组件的名称、导出变量名、外观示例与代码来源整理成可以直接在浏览器里查阅的 HTML 目录，同时保留生成它所需的脚本与结构化数据。

产物是静态 HTML，双击即可打开，不需要服务器、不需要联网。

## 产出物

| 文件 | 内容 |
|---|---|
| [index.html](index.html) | 总览：调研方法、覆盖统计、组件分层、包分布、复现命令。 |
| [primitives.html](primitives.html) | 基础组件库 `ui-primitives` 的图鉴：共享原子的实时重绘、Props 表与设计变量。 |
| [product.html](product.html) | 产品组件图鉴：会话流、外壳、设置页、功能面板、浮层与运行时视图。 |
| [tokens.html](tokens.html) | 设计变量参考：`--dsw-*` 静态色板、语义别名、圆角、字体排印、浮层描边与投影，含浅色/深色取值与引用计数。 |
| [inventory.html](inventory.html) | 全量清单：扫描到的每个组件的导出变量名、源码位置、Props 类型、CSS 类名与设计变量，可过滤。 |
| [data/components.json](data/components.json) | 组件清单的机器可读版本（抽取脚本的产物）。 |
| [data/tokens.json](data/tokens.json) | 设计变量的机器可读版本（含每个变量的声明位置与组件引用）。 |
| [data/parts/](data/parts/) | 组件条目（外观示例的 HTML 与元数据），按批次分文件，共 116 条 / 293 个示例。 |
| [data/ENTRY-SCHEMA.md](data/ENTRY-SCHEMA.md) | 条目写入规范：字段含义与硬性规则。 |
| [assets/](assets/) | 嵌入用的中文子集字体（`cjk-400.woff2` / `cjk-500.woff2`，OFL 授权的 Noto Sans SC 子集）。 |
| [tools/](tools/) | 生成与校验脚本：`extract.mjs`、`extract-tokens.mjs`、`build.mjs`、`font.mjs`、`validate.mjs`、`check.mjs`。 |

## 外观示例是怎么画出来的

示例不是截图，也不是照着截图重写的近似样式，而是**直接加载组件自己的样式表源码**渲染出来的：

1. 每个组件的 `*.module.css` 原文被内联进一个声明式 Shadow DOM（`<template shadowrootmode="open">`），因此组件 CSS 逐字生效，且不会泄漏到目录页自身。
2. 页面的 `<body>` 内联了 `packages/client/ui-theme/src/styles/` 下的真实主题样式表，所以示例消费的是真实的 `--dsw-*` 变量。自定义属性会继承穿过 shadow 边界，点左栏底部的主题按钮即可让所有示例在浅色与深色取值之间切换；组件 CSS 里针对 `body[data-ds-dark-theme]` 的规则在 shadow root 里改写成 `:host(...)`，因此切换时预览宿主也会带上同一个属性。
3. 示例里的 HTML 使用组件 `.tsx` 里实际 `clsx` 的类名，由抽取到的源码结构决定；构建脚本只做三件机械改写：去掉 `:global(...)` 包装、把 `:root` / `html` / `body` 选择器改成 `:host`（shadow root 里没有文档级选择器），以及在组件 CSS 之前插入一条预览重置 `button, input, select, textarea { font-family: inherit }`——浏览器给表单控件的默认字体不含中文，真实产品靠操作系统字体补上，目录页改用内嵌子集。
4. 需要 JavaScript 才能产生的状态（悬停、展开、打开、焦点）以静态近似呈现：条目自带一小段附加 CSS 复刻真实规则的视觉效果，并在示例标题旁标注。

依赖布局父级的组件（侧边栏、设置页、面板）在示例里补一层只声明 `width` / `display` 的无类名容器。

## 覆盖范围

清单页收录 `packages/client/`、`packages/experimental/`、`packages/extensions/` 下全部 `.tsx` 里的每个 React 组件导出，共 601 个。图鉴页收录其中具代表性的组件：基础组件库的全部可视导出，加上产品层最常出现在用户视野里的组件；其余组件在清单页给出源码位置与所属包，可据此直接阅读实现。

图标与美术按族合并成条目（例如 8 个权限图标一条、5 个插件美术一条），字形数量在条目内逐个列出。

判定规则：`primitive` 为 `ui-primitives` 的共享原子；`icon`、`artwork` 为字形与品牌美术；`product` 为功能包组件；`experimental`、`extension` 为实验包与扩展包。`packages/client/AGENTS.md` 规定功能包之间不能互相导入组件，`ui-primitives` 是唯一可以跨包复用的组件来源——图鉴页因此按这条边界分成两页。

## 重新生成

```sh
cd <本目录>
node tools/extract.mjs         # 扫描 .tsx → data/components.json
node tools/extract-tokens.mjs  # 解析 ui-theme 样式表 → data/tokens.json
node tools/build.mjs           # 组装五张页面
node tools/check.mjs           # 条目校验 + 仓库引用规则 + 页面产物体积
```

前两个脚本要读 `packages/client/` 下的源码，因此必须把本目录放在 deepseek-harness 检出的 `UIUX/` 位置再运行；`build.mjs` 与 `check.mjs` 只需要本目录自己的数据。

`check.mjs` 会做三件事：校验每个条目的必填字段、类名归属、设计变量与源码行号；按 `scripts/verify-repository-references.ts` 的规则确认目录内没有提交号或组织 URL；统计五张页面的体积与预览数量。

页面是中文的，而生成机器上不一定装了中文字体。构建脚本会统计页面用到的全部汉字写入 `data/cjk-charset.txt`，并在缺少覆盖时提示；此时先跑字体子集再重新构建：

```sh
mkdir -p /tmp/dsh-uiux-font && cd /tmp/dsh-uiux-font
npm install --cache ./.npm-cache subset-font
cd - && node <本目录>/tools/font.mjs --tools /tmp/dsh-uiux-font
node <本目录>/tools/build.mjs
```

`subset-font` 只是构建期工具，刻意不写进仓库依赖。字体源文件在首次运行时从 `notofonts/noto-cjk` 下载到 `--cache` 目录；`assets/*.woff2` 是产物，可以随目录一起提交。

## 同名类的处理

真实构建会给每个 CSS Module 的类名加哈希，所以 `ReasoningRow.module.css` 与 `DisclosureRow.module.css` 里的 `.root` 是两个互不相干的选择器。目录页把样式表逐字内联进同一个 Shadow DOM，必须自己还原这层隔离：当条目列出两张以上样式表时，构建脚本按文件把类名改写成 `c<下标>-<原名>`（下标是 `css` 数组的下标），HTML 里的类名同步改写。

类名归属的判定顺序是「与组件源文件同名的那张样式表」→「`css` 中第一张声明了该类的表」。当元素属于非主样式表、而类名在主表里也存在时，条目直接写带前缀的类名，构建脚本原样保留；规则见 [data/ENTRY-SCHEMA.md](data/ENTRY-SCHEMA.md) 的「多张样式表与同名类」。

## 数据字段

`data/components.json` 的每个组件记录包含：`name`（组件名）、`exportName`（导出变量名）、`kind`（分层判定）、`package`、`file` 与 `line`（代码来源）、`propsType`、`doc`（源码 JSDoc）、`cssModule`、`cssClasses`、`tokens`（该组件 CSS 引用的设计变量）、`publicExport`（是否在包的 `src/index.ts` 中公开导出）。

`data/parts/*.json` 的每个条目记录包含：`id`、`name`、`exportName`、`zh`、`group`、`summary`、`source`、`css`、`tokens`、`specimens`、`props`、`notes`，字段含义见 [data/ENTRY-SCHEMA.md](data/ENTRY-SCHEMA.md)。

## 说明

页面在 `<head>` 内嵌了中文字体子集，因此单个 HTML 文件可以独立分发；代价是每页约 610 KiB 的字体数据（base64），五张页面合计约 7.4 MiB。清单页与变量页的数据规模较大，用浏览器搜索或页面自带的过滤框定位比滚动更快。

目录数据取自工作区源码快照，页面顶部记录了快照日期；重新生成即可与当前源码对齐。
