# AGENTS.md — Content Extractor

> Chrome 扩展：从任意网页（含登录态页面）提取干净内容为 Markdown，支持拖拽导出和一键发送至 OpenClaw Bot。
>
> 架构：Content Script（DOM 提取）→ Service Worker（存储 + API）→ Side Panel（UI）→ OpenClaw `/hooks/agent`

---

## 1. 编码规范

- **语言**：TypeScript (strict mode)
- **格式化**：Prettier（默认配置）| **Lint**：ESLint + `@typescript-eslint`
- **命名**：文件 `kebab-case` | 类/接口 `PascalCase` | 函数/变量 `camelCase` | 常量 `UPPER_SNAKE_CASE`

### 目录结构

```
src/
├── content/           # Content Script — extractor.ts, selectors.ts, index.ts
├── background/        # Service Worker — api.ts, storage.ts, crawler.ts, index.ts
├── sidepanel/         # Side Panel UI — App.tsx, FileList.tsx, FileCard.tsx, Settings.tsx
├── shared/            # 共享类型 — types.ts, constants.ts, messages.ts
└── lib/               # 第三方封装 — readability.ts, turndown.ts
```

---

## 2. 数据模型

```typescript
interface CapturedFile {
  id: string;
  title: string;
  sourceUrl: string;
  capturedAt: string;            // ISO 8601
  markdown: string;
  links: ExtractedLink[];
  parentId?: string;             // 父页面链接跟踪
  depth: number;                 // 0 = 主页面
  siteType?: 'outlook' | 'gmail' | 'generic';
}

interface ExtractedLink {
  url: string;
  text: string;
  crawled: boolean;
  childFileId?: string;
}
```

导出格式：Markdown + YAML front matter（title, source, captured_at, extractor, site_type, links_found/crawled, parent, depth）。

---

## 3. 测试流程（强制）

每次修改提取逻辑后**必须**执行：

```bash
npx tsx test/extract.ts
```

- 输入 `test/*.html` → 输出 `test/*.md`（同级目录，非 `test/output/`）
- 确认每个 `.html` 都有对应的非空 `.md`
- 抽查 1-2 个文件确认质量

**注意**：离线测试通过 ≠ 扩展可用。JSDOM 与真实 DOM 存在差异，两个都必须通过。

---

## 4. 踩坑记录

### Outlook 域名

`isOutlookHost()` 必须覆盖所有变体：`outlook.office.com`、`outlook.office365.com`、`outlook.live.com`、`outlook.cloud.microsoft`。**永远不要假设 Outlook 只有一个域名。**

### Outlook 选择器策略链

| 优先级 | 选择器 | 适用场景 |
|--------|--------|---------|
| 1 | `[id^="UniqueMessageBody"]` | 大多数版本 |
| 2 | `[aria-label="邮件正文"]` | 中文 UI |
| 3 | `[aria-label="Message body"]` | 英文 UI |
| 4 | `[role="document"][aria-label]` | 通用 reading pane |
| 5 | `[class^="rps_"]` | 关键兜底 |

### 构建后验证

每次 `npm run build` 后，在 `dist/content-script.js` 中搜索关键字符串确认改动已包含：

```powershell
Select-String -Path "dist/content-script.js" -Pattern "outlook.cloud.microsoft" -SimpleMatch
Select-String -Path "dist/content-script.js" -Pattern "rps_" -SimpleMatch
```

### 调试流程

1. Console 查 `[ContentExtractor:Content] Content script loaded on <hostname>` — 确认注入
2. 查 `siteType` — 如果 Outlook 显示 `generic` 说明域名匹配遗漏
3. 查 `targetElement` — `null` 说明选择器全部未命中
4. 查 `markdown length: N` — 0 说明过度清理或提取失败

### CSP

`chrome.scripting.executeScript` 注入的 content script **不受页面 CSP 限制**。Outlook Console 中的 CSP 警告与本扩展无关。

---

## 5. 安全原则

- 所有操作需用户显式点击，无自动提取
- Token 仅存 `chrome.storage.sync`，不在 content script 中暴露
- API 请求仅从 Service Worker 发出
- 权限最小化：`activeTab` + `scripting`，链接跟踪用 `optional_host_permissions`
