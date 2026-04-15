import { Fragment } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import type { CapturedFile } from '../shared/types';
import { FileCard } from './FileCard';
import { Settings } from './Settings';

const IconSettings = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
);

const IconFile = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
);

const IconMerge = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
);

const IconTrash = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
);

const IconArrowLeft = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
);

export const App = () => {
  const [files, setFiles] = useState<CapturedFile[]>([]);
  const [view, setView] = useState<'list' | 'settings' | 'preview'>('list');
  const [extracting, setExtracting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<CapturedFile | null>(null);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_FILES' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError);
        return;
      }
      if (response && response.success) {
        setFiles(response.data || []);
      }
    });

    const listener = (message: Record<string, unknown>) => {
      if (message.type === 'FILES_UPDATED') {
        chrome.runtime.sendMessage({ type: 'GET_FILES' }, (res) => {
          if (res && res.success) {
            setFiles(res.data || []);
          }
        });
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const handleExtract = () => {
    console.log('[ContentExtractor:SidePanel] Extract button clicked');
    setExtracting(true);
    chrome.runtime.sendMessage({ type: 'EXTRACT_CURRENT_TAB' }, (response) => {
      console.log('[ContentExtractor:SidePanel] Extract response:', response);
      if (chrome.runtime.lastError) {
        console.error('[ContentExtractor:SidePanel] Extract error:', chrome.runtime.lastError.message);
      }
      setExtracting(false);
    });
  };

  const handleDelete = (id: string) => {
    chrome.runtime.sendMessage({ type: 'DELETE_FILE', fileId: id });
    setFiles((prev) => prev.filter((f) => f.id !== id));
    if (selectedFile?.id === id) {
      setSelectedFile(null);
      setView('list');
    }
  };

  const handleOpenPreview = (file: CapturedFile) => {
    setSelectedFile(file);
    setView('preview');
  };

  const handleMergeAll = () => {
    chrome.runtime.sendMessage({ type: 'MERGE_ALL_FILES' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[ContentExtractor:Popup] Merge error:', chrome.runtime.lastError.message);
        return;
      }

      if (response?.success && response.data) {
        setSelectedFile(null);
        setView('list');
      }
    });
  };

  const handleClearAll = () => {
    if (confirm('Delete all extracted files?')) {
      chrome.runtime.sendMessage({ type: 'CLEAR_ALL_FILES' });
      setFiles([]);
    }
  };

  if (view === 'settings') {
    return <Settings onBack={() => setView('list')} />;
  }

  if (view === 'preview' && selectedFile) {
    return (
      <Fragment>
        <div className="panel-header">
          <button onClick={() => setView('list')} className="btn-icon" title="Back">
            <IconArrowLeft />
          </button>
          <div className="truncate panel-title">{selectedFile.emailSubject || selectedFile.title || 'Preview'}</div>
        </div>

        <div className="preview-wrap">
          <div className="preview-meta">
            <div style="font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 6px; line-height: 1.35;">
              {selectedFile.emailSubject || selectedFile.title || 'Untitled'}
            </div>
            {selectedFile.isMerged && (
              <div className="text-secondary text-sm" style="margin-bottom: 4px;">
                包含 {selectedFile.mergedPageCount ?? 0} 个页面
              </div>
            )}
            {selectedFile.sender && (
              <div className="text-secondary text-sm truncate" style="margin-bottom: 4px;">
                {selectedFile.sender}
              </div>
            )}
            <div className="text-secondary text-xs truncate">{selectedFile.sourceUrl}</div>
          </div>

          <div className="preview-body">
            <pre className="preview-text">{selectedFile.markdown}</pre>
          </div>
        </div>
      </Fragment>
    );
  }

  return (
    <Fragment>
      <div style="padding: 16px; border-bottom: 1px solid var(--border); background: var(--bg); position: sticky; top: 0; z-index: 10;">
        <button
          onClick={handleExtract}
          className="btn-primary w-full"
          disabled={extracting}
          style="height: 38px; box-shadow: var(--shadow-sm);"
        >
          {extracting ? (
            <Fragment>
              <svg className="spinner" style="animation: spin 1s linear infinite; width: 14px; height: 14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>
              <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
              Extracting...
            </Fragment>
          ) : (
            <Fragment>
              <IconFile />
              Extract Current Page
            </Fragment>
          )}
        </button>
      </div>

      <div className="file-list">
        <div style="padding: 16px 0 8px 0; color: var(--text-secondary); font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em;">
          <span>Extracted Files ({files.length})</span>
        </div>

        {files.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>
            </div>
            <p style="font-size: 13px; font-weight: 500; color: var(--text); margin-bottom: 4px;">No files extracted</p>
            <p style="font-size: 12px; line-height: 1.5;">Click "Extract" to save content.</p>
          </div>
        ) : (
          files.map((file) => (
            <FileCard
              key={file.id}
              file={file}
              onDelete={handleDelete}
              onOpen={handleOpenPreview}
            />
          ))
        )}
        <div style="height: 16px;"></div>
      </div>

      <div className="action-bar">
        <button
          onClick={() => setView('settings')}
          className="btn-icon"
          title="Settings"
          style="padding: 8px;"
        >
          <IconSettings />
        </button>
        <div style="flex: 1;"></div>
        {files.length > 0 && (
          <Fragment>
            <button
              onClick={handleMergeAll}
              className="btn-accent"
              style="padding: 6px 12px; height: 32px;"
            >
              <IconMerge /> Merge
            </button>
            <button
              onClick={handleClearAll}
              className="btn-icon"
              title="Clear All"
              style="height: 32px; width: 32px; padding: 0; color: var(--error);"
            >
              <IconTrash />
            </button>
          </Fragment>
        )}
      </div>
    </Fragment>
  );
};
