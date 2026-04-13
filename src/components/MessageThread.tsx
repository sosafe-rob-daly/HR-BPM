import type { Message } from '../types/chat';

interface MessageThreadProps {
  messages: Message[];
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function MessageThread({ messages }: MessageThreadProps) {
  return (
    <div className="message-thread">
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

          <div className="message-meta">{formatTime(msg.timestamp)}</div>
        </div>
      ))}
    </div>
  );
}
