import { useState, useEffect } from 'react';
import ChatInput from './ChatInput';
import { SLASH_COMMANDS } from '../commands';

interface WelcomeProps {
  onSend: (text: string) => void;
  onSlashCommand: (commandId: string) => void;
  disabled?: boolean;
}

const COMMAND_ICONS: Record<string, JSX.Element> = {
  compass: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
    </svg>
  ),
  pencil: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  ),
};

export default function Welcome({ onSend, onSlashCommand, disabled }: WelcomeProps) {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setStage(1), 100);
    const t2 = setTimeout(() => setStage(2), 700);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  return (
    <div className="welcome">
      <div className="welcome-content">
        <div className={`welcome-greeting ${stage >= 1 ? 'welcome-greeting--visible' : ''}`}>
          <img src={import.meta.env.BASE_URL + 'sosafe-logo.png'} alt="SoSafe HRBP" className="welcome-logo" />
        </div>
        <div className={`welcome-main ${stage >= 2 ? 'welcome-main--visible' : ''}`}>
          <h2>What can I help with?</h2>
          <div className="welcome-commands">
            {SLASH_COMMANDS.map((cmd) => (
              <button
                key={cmd.id}
                className="welcome-command-card"
                onClick={() => onSlashCommand(cmd.id)}
                disabled={disabled}
              >
                <div className="welcome-command-icon">
                  {COMMAND_ICONS[cmd.icon] ?? null}
                </div>
                <div className="welcome-command-text">
                  <span className="welcome-command-name">{cmd.label}</span>
                  <span className="welcome-command-desc">{cmd.description}</span>
                </div>
              </button>
            ))}
          </div>
          <div className="welcome-input">
            <ChatInput
              onSend={onSend}
              onSlashCommand={onSlashCommand}
              disabled={disabled}
              placeholder="Describe your situation..."
            />
          </div>
        </div>
      </div>
    </div>
  );
}
