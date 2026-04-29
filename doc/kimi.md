# Kimi (kimi.com / kimi.ai)

## 适配时间
2026-04-29

## 页面特征

- **SPA 应用**：内容由 JS 渲染，但用户保存的 HTML 快照已包含渲染后的 DOM。
- **实际域名**：`www.kimi.com`（不是 `kimi.ai`，这是初始适配时漏掉的关键点）。
- **内容容器**：`.chat-content-list`，内部包含完整的对话历史（用户消息 + 助手消息）。

## 选择器策略

| 优先级 | 选择器 | 说明 |
|--------|--------|------|
| 1 | `.chat-content-list` | 对话列表容器，包含所有消息 |
| 2 | `.chat-detail-content` | 备选 |
| 3 | `.chat-detail-main` | 备选 |
| 4 | `.markdown-container` | 最终备选 |

## 清理要点

需要移除的 UI 元素：

- `.segment-assistant-actions` / `.segment-user-actions` — 编辑/复制/分享按钮
- `.simple-button` — 通用按钮
- `.toolcall-title-container` / `.toolcall-title-name` — 工具调用标题栏（如"搜索网页"）
- `.table-actions` / `.table-actions-content` — 表格操作栏（复制按钮等）
- `.chat-action` — 聊天操作按钮
- `.rag-tag` — 引用来源标记（见下文）

## 引用来源（rag-tag）处理

Kimi 的引用标记是 `.rag-tag` 元素，有两种变体：

1. **`<a class="rag-tag" href="...">`** — 带链接的引用（但实际页面中，href 是懒加载的：鼠标悬停时通过 API `GetSearchCitation` 动态获取，DOM 中初始可能没有 href）。
2. **`<div class="rag-tag" data-site-name="...">`** — 纯文本标记，只有网站名。

### 处理策略

- 如果有 `href` → 保留为 `[网站名](链接)` Markdown 链接
- 如果只有 `data-site-name` → 转换为 `[ref: 网站名]` 文本标记
- 在 Markdown 末尾追加「引用来源」列表

### 关键教训

> **测试文件 ≠ 真实页面**：测试 HTML 中的 rag-tag 全部是 `<div>`，但实际运行的 Kimi 页面中部分 rag-tag 是 `<a>`。必须通过浏览器 DevTools 验证实际 DOM 结构。

> **懒加载链接**：引用链接不是静态写在 HTML 中的，而是通过 API 调用 `GetSearchCitation` 在鼠标悬停时动态加载。这意味着 Content Script 提取时通常拿不到真实的引用 URL（除非用户提前悬停过所有引用）。

## 通用适配流程

1. 用浏览器打开目标页面（确保内容已渲染）
2. 在 DevTools Console 中分析 DOM 结构：
   - `document.querySelectorAll('.chat-content-list').length`
   - 检查内容容器内部的子元素结构
   - 区分「思考过程」和「最终回答」的 DOM 位置
3. 保存 HTML 到 `test/` 作为测试用例
4. 运行 `npx tsx test/extract.ts` 验证
5. 同时验证真实浏览器中的提取效果（JSDOM ≠ 真实 DOM）
