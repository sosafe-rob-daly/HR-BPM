import { useState, useEffect } from 'react';
import ChatInput from './ChatInput';
import { getTheme } from '../themes';

interface WelcomeProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  themeId?: string;
}

export default function Welcome({ onSend, disabled, themeId }: WelcomeProps) {
  const [stage, setStage] = useState(0);
  const theme = getTheme(themeId);

  useEffect(() => {
    const t1 = setTimeout(() => setStage(1), 100);
    const t2 = setTimeout(() => setStage(2), 700);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  return (
    <div className="welcome" style={{ backgroundImage: `url(${theme.image})` }}>
      <div className="welcome-content">
        <p className={`welcome-greeting ${stage >= 1 ? 'welcome-greeting--visible' : ''}`}>
          Welcome to SoSafe HRBP
        </p>
        <div className={`welcome-main ${stage >= 2 ? 'welcome-main--visible' : ''}`}>
          <h2>What can I help with?</h2>
          <div className="welcome-input">
            <ChatInput onSend={onSend} disabled={disabled} placeholder="Describe your situation..." />
          </div>
        </div>
      </div>
    </div>
  );
}
