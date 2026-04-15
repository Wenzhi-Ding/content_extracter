# Content Extractor

**Chrome 扩展** — 从任意网页（包括需要登录的邮箱页面）提取干净内容，转换为 Markdown，支持拖拽导出和多文件合并。

**Chrome Extension** — Extract clean content from any web page (including authenticated email clients) as Markdown, with drag-export and multi-file merge support.

---

## 功能 | Features

- 📄 **一键提取** — 从当前页面提取正文，自动识别邮件、新闻、普通网页
- 🔗 **链接爬取** — 自动追踪邮件中的财新等文章链接，在后台标签页中提取内容
- 📝 **Markdown 输出** — 内容转换为干净的 Markdown，自动清理广告、追踪像素、页脚
- 📁 **文件管理** — Side Panel 中查看、删除、合并已提取的文件
- 🖱️ **拖拽导出** — 直接拖拽文件卡片到任意应用

- 📄 **One-click extraction** — Extract main content from the current page, auto-detecting emails, news, and generic pages
- 🔗 **Link crawling** — Auto-follow Caixin article links found in emails, extracting content in background tabs
- 📝 **Markdown output** — Content converted to clean Markdown with automatic removal of ads, tracking pixels, and footers
- 📁 **File management** — View, delete, and merge extracted files in the Side Panel
- 🖱️ **Drag export** — Drag file cards directly into any application

## 支持的站点 | Supported Sites

| 类型 | 站点 | 说明 |
|------|------|------|
| **Email** | Outlook Web, Gmail | 提取邮件正文、发件人、主题、日期 |
| **Email** | Outlook Web, Gmail | Extract email body, sender, subject, date |
| **News** | 财新 (Caixin) | 自动点击"余下全文"，提取文章全文 |
| **News** | 财新 (Caixin) | Auto-click "余下全文", extract full article |
| **Generic** | 任意网页 | 自动识别 `article`/`main` 等语义标签，回退到 Readability |
| **Generic** | Any page | Auto-detect `article`/`main` semantic tags, fallback to Readability |

## 安装 | Installation

```bash
# 安装依赖 | Install dependencies
npm install

# 开发模式 | Development mode
npm run dev

# 构建生产版本 | Production build
npm run build
```

构建后在 `chrome://extensions` 中加载 `dist/` 目录（开启开发者模式）。

After building, load the `dist/` directory in `chrome://extensions` (enable Developer mode).

## 使用方法 | Usage

1. 点击工具栏图标打开 Side Panel
2. 在任意网页上点击 **Extract** 按钮
3. 提取完成后，在 Side Panel 中查看结果
4. 拖拽文件卡片导出 Markdown，或使用 **Merge** 合并多个文件

1. Click the toolbar icon to open the Side Panel
2. Click **Extract** on any web page
3. View the result in the Side Panel after extraction completes
4. Drag file cards to export Markdown, or use **Merge** to combine multiple files

## 技术架构 | Architecture

```
Content Script (DOM extraction + sanitization)
    ↓
Service Worker (storage + crawl orchestration)
    ↓
Side Panel (Preact UI)
```

### 关键技术 | Key Technologies

- **Mozilla Readability** — 全页内容提取的兜底方案
- **Turndown** — HTML → Markdown 转换（双模式：邮件 / 网页）
- **Preact** — Side Panel UI
- **@crxjs/vite-plugin** — Chrome Extension 热重载开发
- **Vite** — 构建工具，含自定义 IIFE 包装插件防止 content script 重注入冲突

- **Mozilla Readability** — Full-page content extraction fallback
- **Turndown** — HTML → Markdown conversion (dual mode: email / web)
- **Preact** — Side Panel UI
- **@crxjs/vite-plugin** — Chrome Extension HMR development
- **Vite** — Build tool with custom IIFE wrapper plugin to prevent content script re-injection conflicts

## 测试 | Testing

```bash
npx tsx test/extract.ts
```

离线测试使用 JSDOM 模拟浏览器环境。注意：离线测试通过不代表扩展可用，需要在真实浏览器中验证。

Offline tests use JSDOM to simulate the browser environment. Note: passing offline tests does not guarantee the extension works — always verify in a real browser.

## 项目结构 | Project Structure

```
src/
├── content/           # Content Script — extraction pipeline, selectors, link cleaning
├── background/        # Service Worker — message routing, storage, crawler
├── sidepanel/         # Side Panel UI — Preact components
├── shared/            # Shared types, constants, messages, merge logic
├── lib/               # Third-party wrappers — Readability, Turndown
└── types/             # Type declarations
```

## License

Private project.
