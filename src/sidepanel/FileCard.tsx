import { useState } from 'preact/hooks';
import type { CapturedFile } from '../shared/types';

interface FileCardProps {
  file: CapturedFile;
  onDelete: (id: string) => void;
  onOpen: (file: CapturedFile) => void;
}

const IconDrag = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="12" r="1"></circle><circle cx="9" cy="5" r="1"></circle><circle cx="9" cy="19" r="1"></circle><circle cx="15" cy="12" r="1"></circle><circle cx="15" cy="5" r="1"></circle><circle cx="15" cy="19" r="1"></circle></svg>
);

const IconCopy = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
);

const IconCheck = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--success)"><polyline points="20 6 9 17 4 12"></polyline></svg>
);

const IconDownload = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
);

const IconTrash = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
);

const IconMerged = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13"></path><path d="M8 12h13"></path><path d="M8 18h13"></path><path d="M3 6h.01"></path><path d="M3 12h.01"></path><path d="M3 18h.01"></path></svg>
);

export const FileCard = ({ file, onDelete, onOpen }: FileCardProps) => {
  const [copied, setCopied] = useState(false);
  const isMerged = file.isMerged === true;
  const displayTitle = file.emailSubject || file.title || 'Untitled';
  const secondaryLine = isMerged
    ? `包含 ${file.mergedPageCount ?? 0} 个页面`
    : file.sender;

  const buildExportMarkdown = (): string => {
    const title = file.emailSubject || file.title || 'Untitled';
    const url = file.sourceUrl;
    const date =
      file.emailDate ||
      file.pageDate ||
      new Date(file.capturedAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    return `# ${title}\n${url}\n${date}\n\n${file.markdown}`;
  };

  const makeFilename = (title: string): string => {
    let name = (title || 'untitled').trim();
    name = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '');
    name = name.replace(/['"''""«»「」『』【】〈〉《》（）()\[\]{}&^%$#@!~`+=;]/g, '');
    name = name.replace(/[,，。、；：！？…·—–\-]+/g, '_');
    name = name.replace(/\s+/g, '_');
    name = name.replace(/_+/g, '_');
    name = name.replace(/^_|_$/g, '');
    if (name.length > 120) {
      name = name.slice(0, 120).replace(/_$/, '');
    }
    return (name || 'untitled') + '.md';
  };

  const handleDragStart = (e: DragEvent) => {
    const filename = makeFilename(file.emailSubject || file.title);
    const content = buildExportMarkdown();
    const b64 = btoa(unescape(encodeURIComponent(content)));
    const dataUrl = `data:text/markdown;base64,${b64}`;

    if (e.dataTransfer) {
      e.dataTransfer.setData('DownloadURL', `text/markdown:${filename}:${dataUrl}`);
      e.dataTransfer.setData('text/plain', content);
      e.dataTransfer.effectAllowed = 'copy';
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(buildExportMarkdown()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const handleDownload = () => {
    const filename = makeFilename(file.emailSubject || file.title);
    const blob = new Blob([buildExportMarkdown()], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const stopCardClick = (event: MouseEvent) => {
    event.stopPropagation();
  };

  const timeAgo = (isoDate: string) => {
    const diff = (new Date().getTime() - new Date(isoDate).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  return (
    <div className="card card-clickable" draggable={true} onDragStart={handleDragStart} onClick={() => onOpen(file)}>
      <div className="flex-row gap-2" style="align-items: flex-start;">
        <div className="drag-handle" title="Drag to desktop or chat" onClick={stopCardClick}>
          <IconDrag />
        </div>
        <div className="flex-col w-full" style="overflow: hidden; gap: 4px;">
          <div className="flex-row" style="justify-content: space-between; align-items: flex-start;">
            <strong className="truncate font-semibold" style="line-height: 1.2; padding-top: 2px;" title={displayTitle}>
              {displayTitle}
            </strong>
            <span className="text-secondary text-xs font-medium" style="white-space: nowrap; margin-left: 8px; margin-top: 2px;">
              {file.emailDate || timeAgo(file.capturedAt)}
            </span>
          </div>

          {secondaryLine && (
            <div className="text-secondary text-sm truncate" style="color: var(--text); display: flex; align-items: center; gap: 6px;">
              {isMerged && (
                <span style="display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 999px; background: rgba(255, 255, 255, 0.06); color: #d4d4d8; border: 1px solid #3a3a3a; flex-shrink: 0;">
                  <IconMerged />
                </span>
              )}
              {secondaryLine}
              {isMerged && (
                <span style="margin-left: auto; font-size: 10px; line-height: 1; color: #d4d4d8; background: rgba(255, 255, 255, 0.06); border: 1px solid #3a3a3a; padding: 4px 6px; border-radius: 999px; letter-spacing: 0.02em; text-transform: uppercase;">
                  merged
                </span>
              )}
            </div>
          )}
          
          <div className="text-secondary text-xs truncate" style="opacity: 0.8;">
            {file.sourceUrl}
          </div>

          <div className="flex-row" style="justify-content: space-between; align-items: center; margin-top: 8px;">
            <div className="text-xs text-secondary font-medium" style="background: var(--bg); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border);">
              {(new Blob([file.markdown]).size / 1024).toFixed(1)} KB
            </div>
            <div className="flex-row gap-1">
              <button 
                onClick={(event) => {
                  stopCardClick(event);
                  handleCopy();
                }}
                title="Copy Markdown"
                className="btn-icon"
              >
                {copied ? <IconCheck /> : <IconCopy />}
              </button>

              <button 
                onClick={(event) => {
                  stopCardClick(event);
                  handleDownload();
                }}
                title="Download .md"
                className="btn-icon"
              >
                <IconDownload />
              </button>
              
              <button 
                onClick={(event) => {
                  stopCardClick(event);
                  onDelete(file.id);
                }}
                className="btn-icon btn-error"
                title="Delete"
                style="margin-left: 4px;"
              >
                <IconTrash />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
