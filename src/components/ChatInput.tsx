import { useState, useRef, useCallback, useEffect } from 'react';
import { SLASH_COMMANDS } from '../commands';

interface ChatInputProps {
  onSend: (text: string) => void;
  onSlashCommand: (commandId: string) => void;
  onCancel?: () => void;
  disabled?: boolean;
  placeholder?: string;
}

export default function ChatInput({ onSend, onSlashCommand, onCancel, disabled, placeholder }: ChatInputProps) {
  const [value, setValue] = useState('');
  const [showPalette, setShowPalette] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);

  // Filter commands based on what's typed after /
  const commandFilter = value.startsWith('/') ? value.slice(1).toLowerCase() : '';
  const filteredCommands = showPalette
    ? SLASH_COMMANDS.filter((c) => c.id.startsWith(commandFilter) || c.label.toLowerCase().includes(commandFilter))
    : [];

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [commandFilter]);

  // Close palette on outside click
  useEffect(() => {
    if (!showPalette) return;
    const handleClick = (e: MouseEvent) => {
      if (paletteRef.current && !paletteRef.current.contains(e.target as Node)) {
        setShowPalette(false);
        if (value.startsWith('/') && value.trim().length <= 1) setValue('');
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showPalette]);

  const selectCommand = useCallback((commandId: string) => {
    onSlashCommand(commandId);
    setValue('');
    setShowPalette(false);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [onSlashCommand]);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;

    // If palette is open and there's a match, select the command
    if (showPalette && filteredCommands.length > 0) {
      selectCommand(filteredCommands[selectedIndex].id);
      return;
    }

    onSend(trimmed);
    setValue('');
    setShowPalette(false);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [value, disabled, onSend, showPalette, filteredCommands, selectedIndex, selectCommand]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showPalette && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filteredCommands.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowPalette(false);
        setValue('');
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setValue(newValue);

    // Slash detection
    if (newValue.startsWith('/')) {
      setShowPalette(true);
    } else {
      setShowPalette(false);
    }

    // Auto-resize
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  };

  const hasValue = value.trim().length > 0;

  return (
    <div className="chat-input-area">
      {showPalette && filteredCommands.length > 0 && (
        <div className="command-palette" ref={paletteRef}>
          {filteredCommands.map((cmd, i) => (
            <button
              key={cmd.id}
              className={`command-palette-item ${i === selectedIndex ? 'command-palette-item--selected' : ''}`}
              onClick={() => selectCommand(cmd.id)}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span className="command-palette-slash">/{cmd.id}</span>
              <span className="command-palette-label">{cmd.label}</span>
              <span className="command-palette-desc">{cmd.description}</span>
            </button>
          ))}
        </div>
      )}
      <div className="chat-input-wrapper">
        <button
          className="input-action-btn upload-btn"
          disabled
          title="Attach file (coming soon)"
          aria-label="Attach file"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <button
          className={`input-action-btn command-btn ${showPalette ? 'command-btn--active' : ''}`}
          onClick={() => setShowPalette((prev) => !prev)}
          disabled={disabled}
          title="Commands"
          aria-label="Slash commands"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M7 20L17 4" />
          </svg>
        </button>
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
        {disabled && onCancel ? (
          <button
            className="chat-send-btn chat-stop-btn"
            onClick={onCancel}
            aria-label="Stop generating"
            title="Stop generating"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <rect x="1" y="1" width="12" height="12" rx="2" />
            </svg>
          </button>
        ) : (
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
        )}
      </div>
    </div>
  );
}
