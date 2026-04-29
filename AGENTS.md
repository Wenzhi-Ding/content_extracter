# AGENTS.md — Content Extractor

> Chrome extension: extract clean content from any web page (including logged-in pages) as Markdown. Supports drag-export and merge.
>
> Architecture: Content Script (DOM extraction) → Service Worker (storage + crawl orchestration) → Side Panel (UI)

---

## 1. Coding Standards

- **Language**: TypeScript (strict mode)
- **Formatting**: Prettier (default config) | **Lint**: ESLint + `@typescript-eslint`
- **Naming**: files `kebab-case` | classes/interfaces `PascalCase` | functions/variables `camelCase` | constants `UPPER_SNAKE_CASE`
- **Console logging**: `[ContentExtractor:<Component>]` prefix on all log messages

### Directory Structure

```
src/
├── content/           # Content Script — index.ts (extraction pipeline), selectors.ts, link-cleaner.ts
├── background/        # Service Worker — index.ts (message routing), storage.ts, crawler.ts
├── sidepanel/         # Side Panel UI — index.html, index.tsx, App.tsx, FileCard.tsx, Settings.tsx
├── shared/            # Shared types — types.ts, constants.ts, messages.ts, merge-files.ts
├── lib/               # Third-party wrappers — readability.ts, turndown.ts
└── types/             # Type declarations — turndown-plugin-gfm.d.ts
doc/                   # 网站适配经验教训（按网站分类）
```

---

## 2. Data Models

```typescript
type SiteType = 'outlook' | 'gmail' | 'caixin' | 'generic';

interface ExtractedLink {
  url: string;
  text: string;
  crawled: boolean;
}

interface CapturedFile {
  id: string;
  title: string;
  sourceUrl: string;
  capturedAt: string;            // ISO 8601
  markdown: string;
  links: ExtractedLink[];
  depth: number;                 // 0 = primary page
  siteType: SiteType;            // required, always detected
  sender?: string;               // email sender (Outlook/Gmail)
  emailSubject?: string;         // email subject (Outlook/Gmail)
  emailDate?: string;            // email date (Outlook/Gmail)
  pageDate?: string;             // article publish date (generic sites)
  isMerged?: boolean;            // true for merged collection files
  mergedPageCount?: number;      // number of files in merged collection
}

interface UserConfig {
  maxConcurrentTabs: number;     // background tabs for crawling (1–5, default 3)
}
```

---

## 3. Content Script Injection

Content scripts are injected **programmatically** via `chrome.scripting.executeScript` in the service worker — there are **no declarative content scripts** in the manifest. This means:

- The content script only runs when explicitly triggered (user clicks extract)
- The IIFE wrapper in `vite.config.ts` (`wrap-content-script-iife` plugin) scopes all `const` declarations to function scope, preventing `SyntaxError: Identifier already declared` on re-injection

---

## 4. Extraction Pipeline

### Site Detection → Selector Strategy

| Site Type | Hostname Pattern | Strategy |
|-----------|-----------------|----------|
| `outlook` | `outlook.office.*`, `outlook.live.*`, `outlook.office365.*`, `outlook.cloud.microsoft` | Outlook-specific selectors |
| `gmail` | `mail.google.com` | Gmail-specific selectors |
| `caixin` | `*.caixin.com` | Caixin-specific selectors + "余下全文" click |
| `generic` | everything else | `article` → `[role="main"]` → `main` → `.node__content` → `.post-content` → `null` sentinel |

The `null` sentinel in `DEFAULT_STRATEGIES` signals "fall through to full-page Readability".

### 3-Tier Extraction Path

1. **Target element found** → clone, sanitize (email/caixin), convert innerHTML via Turndown
2. **No target element** → full-page Readability parse → Turndown on `readable.content`
3. **Readability fails** → fallback to `document.body.innerText`

### 7-Step Markdown Post-Processing

After Turndown conversion, the pipeline applies these steps in order:

1. `cleanMarkdownLinks` — unwrap safelinks, clean URLs, remove tracking links
2. `cleanMarkdownContent` — remove boilerplate (unsubscribe, privacy, footer), PUA chars, empty images
3. `convertToReferenceLinks` — inline links → `[text][N]` + reference section; images stripped
4. `cleanAfterReferenceConversion` — second pass for reference-style junk
5. `removeUnusedReferences` — prune `[N]: url` lines not referenced in body
6. `renumberReferences` — renumber sequentially from 1

### Dual Turndown Mode

`htmlToMarkdown(content, isEmail)` uses different rule sets:
- **Email mode** (`isEmail=true`): aggressive table/list cleanup for Outlook/Gmail HTML
- **Web mode** (`isEmail=false`): standard conversion preserving article structure

### Link Extraction & Crawling

- Links are extracted from the content element via `extractLinks()`
- URL cleaning: redirect unwrapping + tracking param removal via `link-cleaner.ts`
- Auto-crawl: Caixin article links in emails are automatically crawled after extraction
- Crawler uses background tabs with configurable concurrency (`maxConcurrentTabs`)

---

## 5. Test Workflow (Mandatory)

After every change to extraction logic, **must** run:

```bash
npx tsx test/extract.ts
```

- Input: `test/*.html` → Output: `test/*.md` (same directory, not `test/output/`)
- Verify every `.html` has a corresponding non-empty `.md`
- Spot-check 1–2 files for quality

**Warning**: Passing offline tests ≠ extension working. JSDOM and real DOM have differences. Both must pass.

**Known tech debt**: `test/extract.ts` mirrors ~600 lines from `src/content/` and `src/lib/` without importing — refactoring this is out of scope.

---

## 6. Pitfalls & Debugging

### Outlook Domain Coverage

`isOutlookHost()` must cover ALL variants: `outlook.office.com`, `outlook.office365.com`, `outlook.live.com`, `outlook.cloud.microsoft`. **Never assume Outlook has only one domain.**

### Outlook Selector Chain

| Priority | Selector | Scenario |
|----------|----------|----------|
| 1 | `[id^="UniqueMessageBody"]` | Most versions |
| 2 | `[aria-label="邮件正文"]` | Chinese UI |
| 3 | `[aria-label="Message body"]` | English UI |
| 4 | `[role="document"][aria-label]` | Generic reading pane |
| 5 | `[class^="rps_"]` | Critical fallback |

### Generic Site Strategy

For sites not matching any specific type, selectors are tried in order (`article` → `[role="main"]` → `main` → `.node__content` → `.post-content`). If none match, full-page Readability is used. `charThreshold: 0` ensures Readability doesn't reject short articles.

### Post-Build Verification

After `npm run build`, search `dist/content-script.js` for key strings to confirm changes are included:

```powershell
Select-String -Path "dist/content-script.js" -Pattern "outlook.cloud.microsoft" -SimpleMatch
Select-String -Path "dist/content-script.js" -Pattern "rps_" -SimpleMatch
```

### Debug Flow

1. Console: `[ContentExtractor:Content] Content script loaded on <hostname>` — confirms injection
2. Check `siteType` — if Outlook shows `generic`, domain matching is missing
3. Check `targetElement` — `null` means all selectors missed
4. Check `markdown length: N` — 0 means over-cleaning or extraction failure

### CSP

Content scripts injected via `chrome.scripting.executeScript` are **not** subject to page CSP. CSP warnings in Outlook console are unrelated to this extension.

### Website Adaptation Lessons

Every time a new site is adapted (or an existing site's extraction logic changes significantly), create or update the corresponding file in `doc/`:

- File naming: `doc/<site-name>.md` (e.g., `doc/kimi.md`, `doc/outlook.md`)
- Content should include: page characteristics, selector strategy, cleanup points, gotchas, and the adaptation process
- These docs are for future maintainers and for reviewing extraction quality across sites

---

## 7. Version Bumping

After completing a feature or bugfix that changes extraction behavior, remind the user to bump the version in `package.json` and update `CHANGELOG.md` (if one exists).

---

## 8. Security Principles

- All operations require explicit user click — no automatic extraction
- API requests sent only from Service Worker
- Permissions: `activeTab` + `scripting` + `storage` + `<all_urls>` host permission
