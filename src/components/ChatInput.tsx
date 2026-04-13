import { useState, useRef, useCallback } from 'react';

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export default function ChatInput({ onSend, disabled, placeholder }: ChatInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, disabled, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  };

  const hasValue = value.trim().length > 0;

  return (
    <div className="chat-input-area">
      <div className="chat-input-wrapper">
        <textarea
          ref={textareaRef}
          className="chat-input"
          placeholder={placeholder ?? "Describe a people situation you need help with..."}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={disabled}
        />
        <button
          className={`chat-send-btn ${hasValue ? 'chat-send-btn--active' : ''}`}
          onClick={handleSubmit}
          disabled={disabled || !hasValue}
          aria-label="Send"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path
              d="M9 14V4M9 4L4.5 8.5M9 4L13.5 8.5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
