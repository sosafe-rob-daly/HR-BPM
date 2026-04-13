import { useState, useEffect } from 'react';
import { getApiKey, setApiKey, clearApiKey, validateConnection } from '../api';
import type { ConnectionStatus } from '../api';
import { themes, getThemeId, setThemeId } from '../themes';

interface SettingsProps {
  open: boolean;
  onClose: () => void;
  onStatusChange: (status: ConnectionStatus) => void;
  onThemeChange: (themeId: string) => void;
}

export default function Settings({ open, onClose, onStatusChange, onThemeChange }: SettingsProps) {
  const [key, setKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [validating, setValidating] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [activeTheme, setActiveTheme] = useState(getThemeId);

  useEffect(() => {
    if (open) {
      const existing = getApiKey();
      setKey(existing ?? '');
      setSaved(!!existing);
      setActiveTheme(getThemeId());
    }
  }, [open]);

  if (!open) return null;

  const handleSave = async () => {
    const trimmed = key.trim();
    if (!trimmed) return;

    setApiKey(trimmed);
    setSaved(true);
    setValidating(true);
    setStatus(null);

    const result = await validateConnection();
    setStatus(result);
    setValidating(false);
    onStatusChange(result);
  };

  const handleClear = () => {
    clearApiKey();
    setKey('');
    setSaved(false);
    setStatus(null);
    onStatusChange({ connected: false, model: null, error: null });
  };

  const handleThemeSelect = (id: string) => {
    setThemeId(id);
    setActiveTheme(id);
    onThemeChange(id);
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h3>Settings</h3>
          <button className="settings-close" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="settings-section">
          <label className="settings-label">Theme</label>
          <div className="theme-grid">
            {themes.map((t) => (
              <button
                key={t.id}
                className={`theme-swatch ${t.id === activeTheme ? 'theme-swatch--active' : ''}`}
                onClick={() => handleThemeSelect(t.id)}
                title={t.name}
              >
                <div
                  className="theme-swatch-preview"
                  style={{ backgroundImage: `url(${t.preview})` }}
                />
                <span className="theme-swatch-name">{t.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="settings-divider" />

        <div className="settings-section">
          <label className="settings-label">OpenAI API Key</label>
          <p className="settings-hint">
            Stored in your browser only. Never sent anywhere except OpenAI's API.
          </p>
          <input
            className="settings-input"
            type="password"
            placeholder="sk-..."
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setSaved(false);
              setStatus(null);
            }}
          />
          <div className="settings-actions">
            <button className="settings-save" onClick={handleSave} disabled={!key.trim() || validating}>
              {validating ? 'Validating...' : saved ? 'Saved' : 'Save & verify'}
            </button>
            {saved && (
              <button className="settings-clear" onClick={handleClear}>
                Clear key
              </button>
            )}
          </div>

          {status && (
            <div className={`settings-status ${status.connected ? 'settings-status--ok' : 'settings-status--error'}`}>
              <span className="settings-status-dot" />
              {status.connected
                ? `Connected · Model: ${status.model}`
                : status.error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
