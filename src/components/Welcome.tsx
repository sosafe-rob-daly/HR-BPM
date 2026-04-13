import ChatInput from './ChatInput';

interface WelcomeProps {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export default function Welcome({ onSend, disabled }: WelcomeProps) {
  return (
    <div className="welcome">
      <div className="welcome-content">
        <h2>What can I help with?</h2>
        <div className="welcome-input">
          <ChatInput onSend={onSend} disabled={disabled} placeholder="Describe your situation..." />
        </div>
      </div>
    </div>
  );
}
