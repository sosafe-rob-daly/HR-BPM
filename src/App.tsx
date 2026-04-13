import { useState, useCallback, useRef, useEffect } from 'react';
import type { Message } from './types/chat';
import { generateMockResponse } from './mock';
import Sidebar from './components/Sidebar';
import ChatInput from './components/ChatInput';
import Welcome from './components/Welcome';

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [topic, setTopic] = useState<string | null>(null);
  const [responding, setResponding] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (threadRef.current) {
        threadRef.current.scrollTop = threadRef.current.scrollHeight;
      }
    });
  }, []);

  useEffect(scrollToBottom, [messages, scrollToBottom]);

  const handleSend = useCallback(
    (text: string) => {
      const userMsg: Message = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: text,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setResponding(true);

      // Simulate agent thinking delay
      setTimeout(() => {
        const { message, topic: newTopic } = generateMockResponse(text);
        setMessages((prev) => [...prev, message]);
        setTopic(newTopic);
        setResponding(false);
      }, 800 + Math.random() * 600);
    },
    [],
  );

  const hasMessages = messages.length > 0;

  return (
    <div className="app">
      <Sidebar topic={topic} />
      <div className="chat-panel">
        <div className="chat-header">
          <div className="chat-header-dot" />
          <div className="chat-header-title">HR Business Partner Agent</div>
        </div>

        {hasMessages ? (
          <div className="message-thread" ref={threadRef}>
            {messages.map((msg) => (
              <div key={msg.id} className={`message message--${msg.role}`}>
                <div className="message-bubble">{msg.content}</div>

                {msg.sources && msg.sources.length > 0 && (
                  <div className="message-sources">
                    {msg.sources.map((s, i) => (
                      <span key={i} className="source-tag">
                        {s.title}
                        {s.lastUpdated && ` · updated ${s.lastUpdated}`}
                      </span>
                    ))}
                  </div>
                )}

                {msg.flags && msg.flags.length > 0 && (
                  <div className="message-flags">
                    {msg.flags.map((f, i) => (
                      <span key={i} className={`flag flag--${f.type}`}>
                        {f.label}
                      </span>
                    ))}
                  </div>
                )}

                <div className="message-meta">
                  {msg.timestamp.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Welcome onPrompt={handleSend} />
        )}

        <ChatInput onSend={handleSend} disabled={responding} />
      </div>
    </div>
  );
}
