import { useState, useEffect } from 'react';
import ChatInput from './ChatInput';

interface WelcomeProps {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export default function Welcome({ onSend, disabled }: WelcomeProps) {
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
          <div className="welcome-input">
            <ChatInput onSend={onSend} disabled={disabled} placeholder="Describe your situation..." />
          </div>
        </div>
      </div>
    </div>
  );
}
