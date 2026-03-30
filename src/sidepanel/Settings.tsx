import { useState, useEffect } from 'preact/hooks';
import type { UserConfig } from '../shared/types';
import { DEFAULT_CONFIG } from '../shared/constants';

interface SettingsProps {
  onBack: () => void;
}

const IconClose = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
);

const IconSave = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
);

export const Settings = ({ onBack }: SettingsProps) => {
  const [config, setConfig] = useState<UserConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, (response) => {
      if (response && response.success) {
        setConfig(response.data);
      }
      setLoading(false);
    });
  }, []);

  const handleChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const { name, value, type, checked } = target;
    setConfig((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleSave = async (e: Event) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      await new Promise<void>((resolve) => {
        chrome.runtime.sendMessage(
          { type: 'SAVE_CONFIG', config },
          (response) => {
            if (response && response.success) {
              setMessage('Saved successfully');
            } else {
              setMessage('Failed to save');
            }
            resolve();
          }
        );
      });
    } catch (err) {
      setMessage('Error saving settings');
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  if (loading) {
    return <div style="padding: 20px; text-align: center; color: var(--text-secondary);">Loading settings...</div>;
  }

  return (
    <div style="padding: 16px; height: 100%; overflow-y: auto; background: var(--bg);">
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 0 0 16px 0; margin-bottom: 24px; border-bottom: 1px solid var(--border);">
        <h3 style="font-size: 15px; font-weight: 600; letter-spacing: -0.01em;">Settings</h3>
        <button onClick={onBack} className="btn-icon" title="Close">
          <IconClose />
        </button>
      </div>

      <form onSubmit={handleSave} style="display: flex; flex-direction: column; gap: 16px;">
        <div className="card" style="margin: 0;">
          <h4 style="font-size: 13px; font-weight: 600; margin-bottom: 12px; color: var(--text);">Crawler Options</h4>
          
          <div style="margin-bottom: 16px;">
            <label>Max Link Depth (0-2)</label>
            <input
              type="number"
              name="maxLinkDepth"
              value={config.maxLinkDepth}
              onInput={handleChange}
              min="0"
              max="2"
              placeholder="e.g. 1"
            />
            <div className="text-xs text-secondary" style="margin-top: -8px;">Depth to follow links from the original page.</div>
          </div>

          <div style="margin-bottom: 16px;">
            <label>Concurrent Tabs</label>
            <input
              type="number"
              name="maxConcurrentTabs"
              value={config.maxConcurrentTabs}
              onInput={handleChange}
              min="1"
              max="5"
              placeholder="e.g. 3"
            />
            <div className="text-xs text-secondary" style="margin-top: -8px;">Number of background tabs to use for crawling.</div>
          </div>

          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div>
              <div style="font-size: 13px; font-weight: 500;">Auto-follow links</div>
              <div className="text-xs text-secondary">Automatically crawl links in the page (experimental)</div>
            </div>
            <label className="toggle-switch" style="margin: 0;">
              <input
                type="checkbox"
                name="autoFollowLinks"
                checked={config.autoFollowLinks}
                onChange={handleChange}
              />
              <span className="slider"></span>
            </label>
          </div>
        </div>

        <div style="display: flex; gap: 12px; align-items: center; margin-top: 8px;">
          <button type="submit" className="btn-primary" disabled={saving} style="height: 36px; padding: 0 16px;">
            {saving ? (
              <svg className="spinner" style="animation: spin 1s linear infinite; width: 14px; height: 14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>
            ) : <IconSave />}
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
          {message && (
            <span style={`font-size: 13px; font-weight: 500; ${message.includes('Error') || message.includes('Failed') ? 'color: var(--error)' : 'color: var(--success)'}`}>
              {message}
            </span>
          )}
        </div>
      </form>
    </div>
  );
};
