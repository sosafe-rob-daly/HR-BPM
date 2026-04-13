import { useState, useEffect } from 'react';
import { getApiKey, setApiKey, clearApiKey } from '../api';

interface SettingsProps {
  open: boolean;
  onClose: () => void;
}

export default function Settings({ open, onClose }: SettingsProps) {
  const [key, setKey] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (open) {
      const existing = getApiKey();
      setKey(existing ?? '');
      setSaved(!!existing);
    }
  }, [open]);

  if (!open) return null;

  const handleSave = () => {
    if (key.trim()) {
      setApiKey(key.trim());
      setSaved(true);
    }
  };

  const handleClear = () => {
    clearApiKey();
    setKey('');
    setSaved(false);
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
            }}
          />
          <div className="settings-actions">
            <button className="settings-save" onClick={handleSave} disabled={!key.trim()}>
              {saved ? 'Saved' : 'Save'}
            </button>
            {saved && (
              <button className="settings-clear" onClick={handleClear}>
                Clear key
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
