import { useState, useCallback, useRef, useEffect } from 'react';
import type { Message } from './types/chat';
import type { SavedChat } from './types/chat';
import { sendMessage, buildHistory, getApiKey, validateConnection } from './api';
import type { ConnectionStatus } from './api';
import { getChats, getChat, saveChat, deleteChat, createChat, titleFromMessages } from './store';
import { getTheme, getThemeId } from './themes';
import Sidebar from './components/Sidebar';
import ChatInput from './components/ChatInput';
import Welcome from './components/Welcome';
import Settings from './components/Settings';

// ── Hash routing helpers ────────────────────────────────────────────

function getChatIdFromHash(): string | null {
  const hash = window.location.hash;
  const match = hash.match(/^#\/chat\/(.+)$/);
  return match ? match[1] : null;
}

function setHash(chatId: string | null) {
  const newHash = chatId ? `#/chat/${chatId}` : '';
  if (window.location.hash !== newHash) {
    window.history.pushState(null, '', newHash || window.location.pathname);
  }
}

// ── App ─────────────────────────────────────────────────────────────

export default function App() {
  const [chats, setChats] = useState<SavedChat[]>(getChats);
  const [activeChatId, setActiveChatId] = useState<string | null>(() => {
    const id = getChatIdFromHash();
    return id && getChat(id) ? id : null;
  });
  const [responding, setResponding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themeId, setThemeId] = useState(getThemeId);
  const [connection, setConnection] = useState<ConnectionStatus>({
    connected: false,
    model: null,
    error: null,
  });
  const threadRef = useRef<HTMLDivElement>(null);

  const activeChat = chats.find((c) => c.id === activeChatId) ?? null;
  const hasMessages = activeChat && activeChat.messages.length > 0;
  const showSidebar = chats.length > 0 || hasMessages;

  // Sync hash → state on back/forward navigation
  useEffect(() => {
    const onHashChange = () => {
      const id = getChatIdFromHash();
      setActiveChatId(id && getChat(id) ? id : null);
      setError(null);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Sync state → hash
  useEffect(() => {
    setHash(activeChatId);
  }, [activeChatId]);

  useEffect(() => {
    if (getApiKey()) {
      validateConnection().then(setConnection);
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (threadRef.current) {
        threadRef.current.scrollTop = threadRef.current.scrollHeight;
      }
    });
  }, []);

  useEffect(scrollToBottom, [activeChat?.messages.length, scrollToBottom]);

  const refreshChats = useCallback(() => {
    setChats(getChats());
  }, []);

  const handleNewChat = useCallback(() => {
    setActiveChatId(null);
    setError(null);
  }, []);

  const handleSelectChat = useCallback((id: string) => {
    setActiveChatId(id);
    setError(null);
  }, []);

  const handleDeleteChat = useCallback((id: string) => {
    deleteChat(id);
    if (activeChatId === id) setActiveChatId(null);
    refreshChats();
  }, [activeChatId, refreshChats]);

  const handleSend = useCallback(
    async (text: string) => {
      if (!getApiKey()) {
        setSettingsOpen(true);
        return;
      }

      setError(null);

      let chat: SavedChat;
      if (activeChat) {
        chat = { ...activeChat };
      } else {
        chat = createChat();
        setActiveChatId(chat.id);
      }

      const userMsg: Message = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: text,
        timestamp: new Date(),
      };

      chat.messages = [...chat.messages, userMsg];
      chat.title = titleFromMessages(chat.messages);
      chat.updatedAt = Date.now();
      saveChat(chat);
      refreshChats();
      setResponding(true);

      try {
        const history = buildHistory(chat.messages);
        const result = await sendMessage(text, history);

        const agentMsg: Message = {
          id: `agent-${Date.now()}`,
          role: 'agent',
          content: result.content,
          timestamp: new Date(),
        };

        chat.messages = [...chat.messages, agentMsg];
        chat.topic = result.topic;
        chat.route = result.route;
        chat.updatedAt = Date.now();
        saveChat(chat);
        refreshChats();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Something went wrong';
        setError(msg);
        if (msg.includes('API key') || msg.includes('401')) {
          setConnection({ connected: false, model: null, error: 'Invalid API key' });
          setSettingsOpen(true);
        }
      } finally {
        setResponding(false);
      }
    },
    [activeChat, refreshChats],
  );

  const theme = getTheme(themeId);

  return (
    <div
      className={`app ${showSidebar ? '' : 'app--no-sidebar'}`}
      style={theme.image
        ? { backgroundImage: `url(${theme.image})` }
        : { background: theme.color ?? undefined }
      }
    >
      {showSidebar && <div className="app-frost" />}
      {showSidebar && (
        <Sidebar
          chats={chats}
          activeChatId={activeChatId}
          onSelectChat={handleSelectChat}
          onNewChat={handleNewChat}
          onDeleteChat={handleDeleteChat}
        />
      )}
      <div className="chat-panel">
        <div className="chat-header">
          <button
            className={`status-pill ${connection.connected ? 'status-pill--on' : 'status-pill--off'}`}
            onClick={() => setSettingsOpen(true)}
          >
            <span className="status-pill-dot" />
            HRBP Agent: {connection.connected ? 'connected' : 'disconnected'}
          </button>
          {activeChat?.route && <span className="route-badge">{activeChat.route}</span>}
          <div style={{ flex: 1 }} />
          <button
            className="settings-btn"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            aria-label="Settings"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          </button>
        </div>

        {hasMessages ? (
          <div className="chat-card">
            <div className="message-thread" ref={threadRef}>
              {activeChat.messages.map((msg) => (
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

              {responding && (
                <div className="message message--agent">
                  <div className="message-bubble typing-indicator">
                    <span /><span /><span />
                  </div>
                </div>
              )}
            </div>

            {error && (
              <div className="chat-error">
                {error}
              </div>
            )}

            <ChatInput onSend={handleSend} disabled={responding} />
          </div>
        ) : (
          <>
            <Welcome onSend={handleSend} disabled={responding} />
            {error && (
              <div className="chat-error">
                {error}
              </div>
            )}
          </>
        )}
      </div>

      <Settings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onStatusChange={setConnection}
        onThemeChange={setThemeId}
      />
    </div>
  );
}
