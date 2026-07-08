# Image Auto Rename

Obsidian 插件，用于自动重命名新建或粘贴进来的图片，同时补充文件列表、Bases 和主题相关的小工具。

## 版本

当前版本：`1.0.2`

## 默认设置

- `Image filename display`：`Show on hover`
- `Hide PNG files in file list`：打开
- `Use Baseline theme`：打开
- `Auto reveal active file in file list`：关闭
- `Add Base name style rule` 默认规则：
  - `canvas`：`#f9a8d4`
  - `md`：`#3f3f46`

## 主要功能

- 自动重命名新建、粘贴或当前文件中的图片。
- 粘贴图片自动改名后，会回写 Markdown、Canvas 中的图片引用，减少偶发的“未找到该图片”问题。
- 可以隐藏文件列表中的 `png` 文件。
- 可以控制 Canvas 图片文件名显示方式：显示、隐藏或悬停显示。
- 可以关闭或打开“文件列表自动追随当前文件”。
- 可以创建默认 `Files.base`，内置规则：
  - `file.ext is not png`
  - `file.ext is not base`
- 默认 Base 属性包含：
  - 名称
  - 扩展名
  - tags
  - aliases
  - 文件反向链接
  - 修改时间
- 可以添加多条 Base 名称样式规则，按扩展名设置名称文字颜色并加粗。
- Base 名称样式颜色支持十六进制输入和颜色选择器。
- 插件加载后会尝试从插件目录下的 `baseline-theme.css` 和 `baseline-manifest.json` 安装并启用 Baseline 主题。

## Baseline 主题

请保持主题文件位于插件目录根目录：

```text
Copy image/
  baseline-manifest.json
  baseline-theme.css
```

启用 `Use Baseline theme` 后，插件会把该主题复制到当前库的 `.obsidian/themes/Baseline/`，然后尝试切换到 `Baseline` 主题。

## GitHub 上传文件

建议上传这些文件：

- `manifest.json`
- `main.js`
- `main.ts`
- `build.js`
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `README.md`
- `CHANGELOG.md`
- `.gitignore`
- `baseline-manifest.json`
- `baseline-theme.css`

不建议上传 `node_modules/`。这个文件夹可以删除，之后需要重新构建时执行 `npm install` 即可恢复依赖。

## 构建

```bash
npm run build
```
