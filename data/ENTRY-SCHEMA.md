# 组件条目编写规范 (entry schema)

本文件是 `UIUX/data/parts/*.json` 的写入契约。构建脚本 `UIUX/tools/build.mjs` 会把
`entries[].css` 指向的真实 CSS Module 源码**逐字**内联进该条目的声明式 Shadow DOM，
因此示例的外观必须完全由真实样式表 + 真实类名决定，不允许自己写样式去"仿制"组件。

参考已完成的样例：`UIUX/data/primitives.json`（Button / Switch / Pill / Tag / StateDot）。

## 文件格式

```json
{
  "schemaVersion": 1,
  "entries": [ /* Entry[] */ ]
}
```

必须是合法 JSON：无注释、无尾逗号、UTF-8。写完用
`node -e "const j=require('./UIUX/data/parts/<你的文件名>.json');console.log(j.entries.length)"` 自检。

## Entry 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | kebab-case 唯一标识，用于页面锚点。例如 `turn-error-node-view`。 |
| `name` | 是 | 组件英文名，与源码导出一致。 |
| `exportName` | 是 | 导出变量名（通常等于 `name`）。这是目录里的"变量名"列。 |
| `zh` | 是 | 中文短名，2–6 字，例如 `回合错误`。 |
| `group` | 是 | 分组键，只能用任务里指定的键。 |
| `summary` | 是 | 中文说明，2–4 句。写清楚"长什么样、用在哪、关键尺寸"；可含 `<code>` 标签。 |
| `source` | 是 | `仓库相对路径#L行号`，行号取导出语句所在行。 |
| `css` | 是 | 该组件真实使用的 CSS Module 路径数组（仓库相对路径）。没有样式表时给 `[]`。 |
| `tokens` | 是 | 该组件 CSS 实际引用的 `--dsw-*` 变量（从 CSS 或 `data/components.json` 的 `tokens` 字段抄）。 |
| `specimens` | 是 | 1–4 个外观示例，见下。 |
| `props` | 否 | Props 表，`{name,type,default,desc}`，从 `.tsx` 的类型定义抄。 |
| `notes` | 否 | 补充说明：状态色、禁用态、无障碍、易混组件等。可含 `<code>`。 |
| `keywords` | 否 | 额外搜索关键词数组（中文别名、英文同义词）。 |

### Specimen 字段

| 字段 | 说明 |
|---|---|
| `label` | 中文示例标题，例如 `变体：primary / ghost`、`禁用态`。 |
| `html` | 该示例的静态 HTML。**类名必须是 `css` 里真实存在的类名**。 |
| `css` | 可选。仅用于静态呈现交互态（hover / active / open / focus / 展开）的附加样式。必须加注释说明"这是状态模拟"。 |
| `note` | 可选。示例旁的小字标注，例如 `悬停模拟`。 |
| `bg` | 可选，默认 `layer1`。可选值：`layer1` `layer2` `platform` `sidebar` `toast` `dark` `none`。 |
| `pad` | 可选，默认 `md`。可选值：`sm` `md` `lg`。 |

## 硬性规则

1. **不许发明类名。** `html` 用到的每个 class 都要能在 `css` 指向的文件里找到对应选择器。
   先读 `.tsx` 看它 `clsx(...)` 了哪些类、在什么条件下加，再读 `.module.css` 确认。2. **不许写内联颜色/圆角/字号**去替代 token。允许的内联样式只有布局性的
   `style="width:10px;height:10px"` 这类尺寸补位（组件 CSS 依赖外部尺寸时）。
3. **不重新定义 token**（不要写 `--dsw-*: ...`），除非是该组件的本地自定义属性且源码里确实有。
4. **交互态用静态近似**：`:hover` 无法静态触发，就在 `css` 里写一条同名效果的类
   （如 `.button.forceHover { ... }`），把真实 hover 规则原样搬过来，并在 `note` 里标注"悬停模拟"。
5. **文字内容用真实语境的占位**（如 `运行 pnpm test`、`packages/client/ui-chat`、
   `深度思考中`），不要用 `foo` `test123`。
6. **中文说明要有信息量**：写尺寸（`36×20`）、变量名、状态差异、使用场景，
   不要写"这是一个按钮组件"这类空话。以源码 JSDoc 和包 README 为准，不要臆测行为。
7. 只写分配给你的文件，**不要修改仓库其它文件**，**不要运行 build.mjs**。
8. 组件的 CSS 会逐字生效，但如果组件依赖父级布局（flex 容器、绝对定位父级），
   在示例里补一层薄薄的容器元素是可以的——容器不要加 class，用 `style` 只写
   `display:flex;gap:12px` 这类布局。
9. 静态快照要把浮层（`position: absolute` 的门户卡片）拉回文档流时，写
   `position: relative; inset: auto`，**不要写 `position: static`**。`relative` 同样让原来的
   `top` / `left` 失效（`inset: auto` 抵消），但留住包含块——`MenuSurface` 的 `.material`
   这类 `inset: 0` 的绝对定位子层靠它确定尺寸，少了它就会以初始包含块为参照铺满整个视口，
   而铺满视口的 `backdrop-filter` 会让浏览器整页画不出来（示例框 `.stage` 虽然也兜了一层，
   但那只保证不画崩，尺寸仍然是错的）。
10. **`autofocus` 会被删掉。** 构建脚本渲染示例时把这个属性去掉：它会真的给控件焦点，
   浏览器随即把整页滚到那张卡的位置——目录一打开就落在半页之外，而静态快照并没有
   需要种子化的焦点。需要靠焦点才成立的态，用 `specimen.css` 把组件的 `:focus` 规则
   原样搬过来并在 `note` 里标注（见 `data/parts/b5-panels.json` 的 `goal-bar` 编辑态）。

## 多张样式表与同名类

`css` 可以列出组件真实 DOM 触到的每一张样式表（例如行组件同时用到 `CodeCard.module.css`）。
构建脚本在条目列出 2 张以上样式表时，会按文件给类名加上 `c<下标>-` 前缀（下标是 `css` 数组的下标，从 0 开始），
相当于还原 CSS Module 的哈希行为，因此 `.root` 这类同名类不会互相串味。

类名归属按这个顺序判定：先看组件自己的样式表（文件名与组件源文件同名的那张），否则取 `css` 中第一张声明了该类的表。
当一个元素属于**非主样式表**、而它的类名在主表里也存在时（典型例子：`DisclosureRow` 里包着 `TextShimmer` 的 `.root`），
直接写带前缀的类名 `c<下标>-<原名>`，构建脚本会原样保留：

```html
<!-- css[0]=DisclosureRow.module.css, css[1]=TextShimmer.module.css -->
<span class="c1-root"><span class="c1-sweep">思考中</span></span>
```

同一条规则也适用于 `specimen.css` 里的选择器。

## 图标类条目的合并约定

同一族的图标（如 8 个权限图标、5 个插件美术）**合并成一条**，在同一个 `specimens.html`
里并排渲染全部字形，每个字形下面用 `<span style="font-size:11px">` 之类的尺寸标注——
注意：标注文字不要加 class（会污染），直接用无 class 的 `<span>` 配 `style`。

## 语言

`summary` / `notes` / `label` / `zh` 用中文；`name` / `exportName` / 代码标识符保持英文原文。

## 归属不明的类名

一个类名被 `css` 里多张样式表同时声明、而示例标记无法说明该元素属于哪一张时，构建脚本会给它挂上全部模块的前缀
（`c0-card c1-card`，按 `css` 顺序，因此排在后面的组件自有样式仍然覆盖前面的共享样式）——这就是内联之前的行为，
也是既有条目校验时所处的状态。`specimen.css` 里的同类选择器改写为 `:is(.c0-card, .c1-card)`，特异性与单个类一致。

只有当你确认某个元素属于非主样式表时，才需要手写前缀把它钉死到某一张表上。
