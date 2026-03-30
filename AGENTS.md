# AGENTS.md — BrowserClaw

> Chrome 扩展：从任意网页（含登录态页面）提取干净内容，打包为 Markdown 文件，支持拖拽导出和一键发送至 OpenClaw Bot。

---

## 1. 核心需求

用户已部署 OpenClaw 网关，当前通过飞书/Telegram/Discord 与 Bot 交互。现需一个浏览器端入口，核心场景：

1. **读取 Outlook 邮件**（需登录态），提取正文 + 邮件内所有链接的页面内容
2. 将提取结果打包为 **Markdown 文件**，在插件侧边栏展示文件列表
3. 每个文件支持两种操作：
   - **(a) 拖拽导出**：拖到桌面 / ChatGPT / Claude 等对话框
   - **(b) 一键发送**：POST 到 OpenClaw `/hooks/agent` 端点
4. 不限于 Outlook —— 任何网页都应可提取

### 为什么必须是浏览器扩展

| 方案 | 登录态页面 | 链接跟踪 | 评估 |
|------|-----------|---------|------|
| Jina Reader (r.jina.ai) | ❌ 无法访问用户 session | ✅ 递归 | 仅适用于公开页面 |
| Python 脚本 + requests | ❌ 需手动注入 cookie | ⚠️ 需编码 | 维护成本高，MFA 难处理 |
| Playwright/Puppeteer | ⚠️ 需持久化浏览器 profile | ✅ 可编程 | 过重，非实时交互 |
| Bookmarklet | ✅ 当前 session | ❌ 无法跟踪链接 | CSP 限制严重 |
| **浏览器扩展** | **✅ 天然继承登录态** | **✅ 可后台打开 tab** | **唯一全满足方案** |

**结论**：浏览器扩展是唯一能同时满足「登录态访问 + 链接跟踪 + 结构化导出 + API 发送」的方案。

---

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                      Chrome Browser                      │
│                                                          │
│  ┌──────────────┐    ┌──────────────┐    ┌────────────┐ │
│  │ Content Script│───▶│Service Worker│◀──▶│ Side Panel │ │
│  │  (per tab)    │    │ (background) │    │   (UI)     │ │
│  └──────────────┘    └──────┬───────┘    └─────┬──────┘ │
│         │                    │                   │        │
│    DOM 读取 +            文件存储 +          文件列表 +    │
│    选择器匹配           API 调用            拖拽/下载      │
│                              │                            │
└──────────────────────────────┼────────────────────────────┘
                               │ HTTPS POST
                               ▼
                    ┌─────────────────────┐
                    │  OpenClaw Gateway    │
                    │  /hooks/agent        │
                    │  Port 18789          │
                    └────────┬────────────┘
                             │ deliver
                             ▼
                    ┌─────────────────────┐
                    │  Bot 响应 → 飞书 /   │
                    │  Telegram / Discord  │
                    └─────────────────────┘
```

### 2.2 组件职责

| 组件 | 技术 | 职责 |
|------|------|------|
| **Content Script** | 注入到目标网页 | 读取 DOM → 选择器定位正文 → 克隆/净化 HTML |
| **Service Worker** | MV3 background | 调用 Readability + Turndown 转换 → 存储文件 → 调用 OpenClaw API → 管理后台 tab 抓取 |
| **Side Panel** | HTML + JS (或 React/Preact) | 文件列表 + 预览 + 拖拽导出 + 发送按钮 + 设置页 |

### 2.3 为什么是独立扩展（不复用 OpenClaw 现有 Chrome Extension）

OpenClaw 自带的 Chrome Extension 是 **CDP 浏览器控制中继**（让 Agent 操控你的 Chrome tab）。它的权限模型和安全边界与内容提取完全不同：

- CDP 扩展需要 `chrome.debugger` 权限 —— 这是高危权限
- 内容提取扩展只需 `activeTab` + `scripting` —— 最小权限原则
- 混合两者会增加 Chrome Web Store 审核难度和安全攻击面

**决策**：构建独立扩展，仅通过共享的 Gateway Token 与 OpenClaw 集成。

---

## 3. 技术栈

### 3.1 核心依赖

| 库 | 版本 | 用途 |
|----|------|------|
| **@mozilla/readability** | latest | 从复杂 DOM 中提取正文（Firefox Reader View 的核心） |
| **turndown** | latest | HTML → Markdown 转换 |
| **turndown-plugin-gfm** | latest | GFM 表格/任务列表支持 |

### 3.2 构建工具

| 工具 | 用途 |
|------|------|
| **Vite** | 打包 content script / service worker / side panel |
| **TypeScript** | 类型安全 |
| **Preact** (推荐) 或 **vanilla JS** | Side Panel UI（轻量） |

### 3.3 Manifest V3 权限

```jsonc
{
  "manifest_version": 3,
  "name": "BrowserClaw",
  "permissions": [
    "activeTab",      // 仅当前激活的 tab
    "scripting",      // 注入 content script
    "sidePanel",      // 侧边栏 UI
    "storage"         // 存储设置 + 文件缓存
  ],
  "host_permissions": [
    // 不需要 <all_urls> —— 通过 activeTab 按需获取权限
    // 仅 OpenClaw 网关地址需要声明（用于 API 调用）
  ],
  "optional_host_permissions": [
    "<all_urls>"      // 用于「跟踪链接」功能，按需请求
  ]
}
```

---

## 4. 数据模型与文件格式

### 4.1 内部文件模型

```typescript
interface CapturedFile {
  id: string;                    // uuid
  title: string;                 // 页面标题 / 邮件主题
  sourceUrl: string;             // 原始 URL
  capturedAt: string;            // ISO 8601
  markdown: string;              // 转换后的 Markdown 内容
  links: ExtractedLink[];        // 页面内发现的链接
  parentId?: string;             // 如果是从某个父页面的链接跟踪来的
  depth: number;                 // 链接跟踪深度 (0 = 主页面)
  siteType?: 'outlook' | 'gmail' | 'generic';  // 用于选择器策略
}

interface ExtractedLink {
  url: string;
  text: string;                  // 锚文本
  crawled: boolean;              // 是否已抓取
  childFileId?: string;          // 抓取后关联的文件 ID
}
```

### 4.2 导出文件格式（Markdown + YAML Front Matter）

```markdown
---
title: "Re: Q1 Budget Review"
source: "https://outlook.office.com/mail/id/AAMk..."
captured_at: "2026-03-12T12:05:30+08:00"
extractor: "browserclaw/1.0.0"
site_type: "outlook"
links_found: 3
links_crawled: 2
parent: null
depth: 0
---

# Re: Q1 Budget Review

From: alice@company.com
Date: 2026-03-11

正文内容...

## 提取的链接

- [Budget Dashboard](./budget-dashboard.md) ✅ 已抓取
- [Policy Document](./policy-document.md) ✅ 已抓取
- [External Link](https://example.com/report) ⏳ 未抓取
```

---

## 5. 内容提取策略

### 5.1 选择器策略链（Site-Specific Selectors）

不同网站的正文 DOM 结构差异巨大。采用「策略链」模式：按优先级尝试匹配，命中即停。

```typescript
const SITE_STRATEGIES: Record<string, SelectorStrategy[]> = {
  'outlook.office.com': [
    { selector: '[aria-label="Message body"]', description: 'Outlook 邮件正文' },
    { selector: '[role="main"] .wide-content-host', description: 'Outlook 阅读面板' },
    { selector: '#ReadingPaneContainerId', description: 'Outlook fallback' },
  ],
  'mail.google.com': [
    { selector: '.a3s.aiL', description: 'Gmail 邮件正文' },
    { selector: '[role="main"] .gs', description: 'Gmail 对话视图' },
  ],
  // 默认策略：直接使用 Readability.js 全页面解析
  '_default': [
    { selector: null, description: '全页面 Readability 解析' },
  ],
};
```

### 5.2 提取流程

```
1. Content Script 被注入 → 检测当前 hostname
2. 匹配 SITE_STRATEGIES → 找到目标 DOM 节点
3. 克隆目标节点（避免修改原始页面）
4. 传递给 Readability.js → 获取干净的 HTML + title
5. 传递给 Turndown → 转换为 Markdown
6. 提取所有 <a href> 链接 → 构建 ExtractedLink[]
7. 组装 CapturedFile → 发送给 Service Worker 存储
```

### 5.3 为什么在扩展内做 Markdown 转换（而非发送原始 HTML）

- **减少 Token 消耗**：Markdown 通常是 HTML 体积的 20-30%
- **降低敏感信息泄露风险**：Readability 会剥离导航栏、侧边栏等包含个人信息的区域
- **提高 LLM 理解准确率**：Markdown 是 LLM 最友好的输入格式
- **导出即用**：用户拖出的文件可直接在 Obsidian/Typora 中打开

---

## 6. 链接跟踪策略

### 6.1 分层处理

邮件中的链接分为两类，处理策略不同：

| 链接类型 | 判断依据 | 处理方式 |
|---------|---------|---------|
| **同域/登录态** | 与当前页面同 origin，或已知需登录的域 | 扩展后台开 tab → 注入 content script → 提取 → 关闭 tab |
| **公开链接** | 外部域名，不需要登录 | 可选：扩展抓取 OR 传 URL 给 OpenClaw（让其 browser tool 处理） |

### 6.2 后台 Tab 抓取流程

```typescript
async function crawlLink(url: string, parentFileId: string): Promise<CapturedFile> {
  // 1. 创建后台 tab（不激活）
  const tab = await chrome.tabs.create({ url, active: false });
  
  // 2. 等待页面加载完成
  await waitForTabLoad(tab.id, { timeoutMs: 15000 });
  
  // 3. 注入 content script 提取内容
  const result = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractPageContent,  // 复用主提取逻辑
  });
  
  // 4. 关闭 tab
  await chrome.tabs.remove(tab.id);
  
  // 5. 返回提取结果
  return { ...result, parentId: parentFileId, depth: 1 };
}
```

### 6.3 限制与安全

- **最大跟踪深度**：1 层（只跟踪邮件内直接链接，不递归）
- **并发限制**：最多同时 3 个后台 tab
- **速率限制**：每个链接间隔 ≥ 1 秒
- **用户确认**：显示链接列表，用户勾选要跟踪的链接后再执行
- **超时**：单个链接 15 秒超时，超时则标记为失败并继续

---

## 7. OpenClaw 集成

### 7.1 API 选择：`/hooks/agent`

| API | 适用场景 | 是否采用 |
|-----|---------|---------|
| `/hooks/agent` | 异步投喂内容，Bot 处理后通过已配置的 channel 回复 | ✅ **主选** |
| `/v1/chat/completions` | 同步请求，直接在扩展内获取回复 | ⚠️ 可选（需用户显式启用） |
| WebSocket (WebChat) | 实时双向对话 | ❌ 过重，不适合「投喂」场景 |

**为什么选 `/hooks/agent`**：
- 不需要用户额外配置（`/v1/chat/completions` 默认禁用）
- 天然支持 `deliver` 参数 —— Bot 处理完后自动推送到飞书/Telegram/Discord
- 支持 `agentId` 路由到指定 Bot
- 异步模型更适合长内容处理

### 7.2 请求格式

```typescript
async function sendToClawBot(file: CapturedFile, config: UserConfig): Promise<void> {
  const payload = {
    message: file.markdown,          // Markdown 全文
    name: "BrowserClaw",             // Hook 来源标识
    agentId: config.agentId || "main",
    deliver: true,                   // 处理完后推送到 channel
    channel: config.channel || "last",  // 推送到哪个 channel
  };

  const response = await fetch(`${config.gatewayUrl}/hooks/agent`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.hooksToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`OpenClaw API error: ${response.status}`);
  }
}
```

### 7.3 用户配置项（存储在 `chrome.storage.sync`）

```typescript
interface UserConfig {
  gatewayUrl: string;       // e.g. "http://localhost:18789" 或远程地址
  hooksToken: string;       // hooks.token（非 gateway auth token）
  agentId: string;          // 目标 Agent ID，默认 "main"
  channel: string;          // 回复推送的 channel，默认 "last"
  maxLinkDepth: number;     // 链接跟踪深度，默认 1
  maxConcurrentTabs: number; // 并发抓取 tab 数，默认 3
  autoFollowLinks: boolean;  // 是否自动跟踪链接，默认 false（需确认）
}
```

---

## 8. Side Panel UI 设计

### 8.1 布局

```
┌──────────────────────────────────┐
│  BrowserClaw          ⚙️ 设置    │
├──────────────────────────────────┤
│  [ 📄 提取当前页面 ]              │
├──────────────────────────────────┤
│  📁 已提取文件 (3)               │
│                                  │
│  ┌────────────────────────────┐  │
│  │ ⠿ Re: Q1 Budget Review    │  │
│  │   outlook.office.com      │  │
│  │   2026-03-12 12:05        │  │
│  │   📎 3 links (2 crawled)  │  │
│  │   [⬇ 下载] [📤 发送ClawBot]│  │
│  └────────────────────────────┘  │
│                                  │
│  ┌────────────────────────────┐  │
│  │ ⠿ Budget Dashboard        │  │
│  │   ↳ 来自: Re: Q1 Budget   │  │
│  │   app.powerbi.com         │  │
│  │   [⬇ 下载] [📤 发送ClawBot]│  │
│  └────────────────────────────┘  │
│                                  │
│  [📤 全部发送至 ClawBot]          │
│  [📦 打包下载 (.zip)]            │
└──────────────────────────────────┘
```

### 8.2 交互细节

- **拖拽导出**：每个文件卡片左侧的 `⠿` 图标为拖拽手柄。拖出时通过 `DownloadURL` API 生成文件。同时提供「⬇ 下载」按钮作为 fallback（使用 `chrome.downloads.download`）。
- **一键发送**：点击「📤 发送 ClawBot」→ 调用 `/hooks/agent` → 按钮状态变为 loading → 成功后显示 ✅
- **批量操作**：底部「全部发送」和「打包下载」支持批量处理
- **文件预览**：点击文件标题展开 Markdown 预览（渲染后的 HTML）

### 8.3 拖拽导出实现

```typescript
function handleDragStart(e: DragEvent, file: CapturedFile) {
  const content = generateMarkdownWithFrontMatter(file);
  const dataUrl = `data:text/markdown;base64,${btoa(unescape(encodeURIComponent(content)))}`;
  const filename = sanitizeFilename(file.title) + '.md';
  
  // Chrome-specific: 拖拽到桌面/文件管理器时生成文件
  e.dataTransfer?.setData('DownloadURL', `text/markdown:${filename}:${dataUrl}`);
  
  // 通用 fallback: 拖拽到支持文本的应用
  e.dataTransfer?.setData('text/plain', content);
}
```

**已知限制**：
- `DownloadURL` 是 Chrome/Chromium 私有 API，Firefox 不支持
- 仅支持单文件拖拽，不支持一次拖多个文件
- `data:` URL 大小受限（约 2MB），超大页面需使用 `blob:` URL 但需注意 Service Worker 生命周期

---

## 9. 安全策略

### 9.1 核心原则

> 扩展处理的是用户的**私人登录态页面**（邮件、内部文档）。安全是第一优先级。

| 风险 | 缓解措施 |
|------|---------|
| 敏感内容泄露 | Readability 剥离侧边栏/导航栏；不存储 raw HTML；文件默认 session 级存储（关闭即清） |
| Gateway Token 泄露 | Token 存储在 `chrome.storage.sync`（加密）；不在 content script 中暴露 |
| 误触发提取 | 所有操作需**用户显式点击**，无自动提取 |
| 链接跟踪越权 | 用户需确认每个要跟踪的链接；有域名白名单机制 |
| API 请求安全 | 仅从 Service Worker 发送（不受页面 CSP 限制）；支持 HTTPS |
| 中间人攻击 | 推荐使用 Tailscale/WireGuard 隧道连接远程 Gateway |

### 9.2 权限最小化

- 不使用 `<all_urls>` —— 通过 `activeTab` 按用户点击获取当前 tab 权限
- 链接跟踪功能需要 `optional_host_permissions`，首次使用时弹出权限请求
- 不使用 `chrome.debugger`（区别于 OpenClaw 的 CDP 扩展）

---

## 10. 开发阶段规划

### Phase 1 — MVP（核心提取 + 发送）

**目标**：能提取任意网页 → 生成 Markdown → 发送到 OpenClaw

- [ ] 项目脚手架（Vite + TypeScript + MV3）
- [ ] Content Script：通用 Readability + Turndown 提取
- [ ] Service Worker：文件存储（`chrome.storage.session`）+ API 调用
- [ ] Side Panel：文件列表 + 下载按钮 + 发送按钮
- [ ] 设置页：Gateway URL + Token 配置
- [ ] 基础错误处理和 loading 状态

### Phase 2 — 增强提取（Site-Specific）

**目标**：Outlook / Gmail 等复杂页面的精准提取

- [ ] 选择器策略链：Outlook Web 专属选择器
- [ ] 选择器策略链：Gmail 专属选择器
- [ ] 邮件元数据提取（发件人、日期、主题）
- [ ] YAML Front Matter 生成
- [ ] 提取结果的 Markdown 预览

### Phase 3 — 链接跟踪

**目标**：自动抓取邮件内链接的目标页面

- [ ] 链接解析与列表展示
- [ ] 用户确认 UI（勾选要跟踪的链接）
- [ ] 后台 Tab 抓取逻辑（并发限制、超时、错误处理）
- [ ] 父子文件关联与展示

### Phase 4 — 拖拽导出

**目标**：文件可拖出扩展到桌面/ChatGPT

- [ ] `DownloadURL` 拖拽实现
- [ ] Blob URL 管理（大文件场景）
- [ ] 批量打包下载（.zip）
- [ ] 拖拽视觉反馈

### Phase 5 — 打磨与扩展

- [ ] 深色模式
- [ ] 文件持久化选项（pin to persist）
- [ ] `/v1/chat/completions` 同步模式（可选）
- [ ] 国际化（中/英）
- [ ] Firefox 兼容评估（Side Panel API 替代方案）

---

## 11. 已知风险与缓解

| 风险 | 严重性 | 缓解策略 |
|------|--------|---------|
| Outlook DOM 结构频繁变更 | 🟡 中 | 选择器策略链 + 多级 fallback + 用户可自定义选择器 |
| `DownloadURL` 是私有 API，可能被废弃 | 🟡 中 | 始终提供 Download 按钮作为 fallback |
| MV3 Service Worker 休眠导致长任务中断 | 🟡 中 | 链接抓取队列持久化到 storage；使用 `chrome.alarms` 保活 |
| 超大页面的 Markdown 超出 LLM context | 🟢 低 | 前端截断 + 分片发送；显示 token 预估 |
| 跨浏览器兼容性（Firefox Side Panel） | 🟢 低 | Phase 5 评估；Firefox 的 `sidebar_action` 可作为备选 |

---

## 12. 参考项目

| 项目 | 借鉴点 |
|------|--------|
| [MarkDownload](https://github.com/deathau/markdownload) | Readability + Turndown 的 Chrome 扩展集成模式 |
| [Obsidian Web Clipper](https://github.com/obsidianmd/obsidian-clipper) | Site-specific 选择器 + 自定义模板 |
| [SingleFile](https://github.com/nicbarker/singlefile) | 完整页面保存的 DOM 克隆技术 |
| [OpenClaw Chrome Extension](https://docs.openclaw.ai/tools/chrome-extension) | Gateway Token 认证模式参考 |

---

## 13. 编码规范

- **语言**：TypeScript (strict mode)
- **格式化**：Prettier（默认配置）
- **Lint**：ESLint + `@typescript-eslint`
- **命名**：
  - 文件：`kebab-case`（如 `content-extractor.ts`）
  - 类/接口：`PascalCase`
  - 函数/变量：`camelCase`
  - 常量：`UPPER_SNAKE_CASE`
- **目录结构**：

```
browser_claw/
├── src/
│   ├── content/           # Content Script（注入到目标页面）
│   │   ├── extractor.ts      # 核心提取逻辑
│   │   ├── selectors.ts      # 站点选择器策略链
│   │   └── index.ts          # Content Script 入口
│   ├── background/        # Service Worker
│   │   ├── api.ts            # OpenClaw API 调用
│   │   ├── storage.ts        # 文件存储管理
│   │   ├── crawler.ts        # 链接跟踪逻辑
│   │   └── index.ts          # Service Worker 入口
│   ├── sidepanel/         # Side Panel UI
│   │   ├── App.tsx           # 主组件
│   │   ├── FileList.tsx      # 文件列表
│   │   ├── FileCard.tsx      # 单文件卡片（含拖拽/发送）
│   │   ├── Settings.tsx      # 设置页
│   │   └── index.html        # Side Panel HTML 入口
│   ├── shared/            # 共享类型和工具
│   │   ├── types.ts          # 数据模型定义
│   │   ├── constants.ts      # 常量
│   │   └── messages.ts       # Chrome messaging 类型定义
│   └── lib/               # 第三方库的薄封装
│       ├── readability.ts    # Readability 封装
│       └── turndown.ts       # Turndown 封装 + GFM 插件
├── public/
│   └── icons/             # 扩展图标
├── manifest.json
├── vite.config.ts
├── tsconfig.json
├── package.json
└── AGENTS.md              # 本文件
```

---

## 14. 与 Gemini 对话方案的差异说明

在前期对话中，Gemini 提出了以下方案。本 AGENTS.md 在此基础上做了关键修正：

| Gemini 方案 | 本方案修正 | 原因 |
|------------|-----------|------|
| Popup 弹窗 UI | **Side Panel** | Popup 点击页面即关闭，不适合「提取 → 预览 → 拖拽」流程 |
| `fetch` 直连 OpenAI 格式 API | **`/hooks/agent`** webhook | hooks 端点默认可用，支持 deliver 到 channel，无需额外启用 |
| `document.body.innerText` 提取 | **Readability + Turndown** | innerText 会抓到导航栏、广告等噪声 |
| Jina Reader 用于所有页面 | **仅用于公开页面的备选** | Jina 无法访问登录态页面 |
| 单次提取，无链接跟踪 | **后台 Tab 链接跟踪** | 用户核心需求包含「把链接也都读了」 |
