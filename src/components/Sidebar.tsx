import type { SavedChat } from '../types/chat';

interface SidebarProps {
  chats: SavedChat[];
  activeChatId: string | null;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onDeleteChat: (id: string) => void;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function Sidebar({
  chats,
  activeChatId,
  onSelectChat,
  onNewChat,
  onDeleteChat,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-brand-icon">BP</div>
        <h1>HR-BPM</h1>
      </div>

      <button className="sidebar-new-btn" onClick={onNewChat}>
        + New conversation
      </button>

      <div className="sidebar-chats">
        {chats.map((chat) => (
          <div
            key={chat.id}
            className={`sidebar-chat ${chat.id === activeChatId ? 'sidebar-chat--active' : ''}`}
            onClick={() => onSelectChat(chat.id)}
          >
            <div className="sidebar-chat-title">{chat.title}</div>
            <div className="sidebar-chat-meta">
              {chat.topic && <span className="sidebar-chat-topic">{chat.topic}</span>}
              <span className="sidebar-chat-time">{timeAgo(chat.updatedAt)}</span>
            </div>
            <button
              className="sidebar-chat-delete"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteChat(chat.id);
              }}
              title="Delete conversation"
            >
              &times;
            </button>
          </div>
        ))}

        {chats.length === 0 && (
          <div className="sidebar-empty">
            No conversations yet
          </div>
        )}
      </div>

      <div className="sidebar-spacer" />

      <div className="sidebar-footer">
        Time-sensitive info is flagged with source and recency.
        When in doubt, confirm with your HRBP.
      </div>
    </aside>
  );
}
