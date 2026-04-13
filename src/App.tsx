import { useState, useCallback, useRef, useEffect } from 'react';
import type { Message } from './types/chat';
import type { SavedChat } from './types/chat';
import { sendMessage, buildHistory, getApiKey, validateConnection } from './api';
import type { ConnectionStatus } from './api';
import { getChats, saveChat, deleteChat, createChat, titleFromMessages } from './store';
import Sidebar from './components/Sidebar';
import ChatInput from './components/ChatInput';
import Welcome from './components/Welcome';
import Settings from './components/Settings';

export default function App() {
  const [chats, setChats] = useState<SavedChat[]>(getChats);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [responding, setResponding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [connection, setConnection] = useState<ConnectionStatus>({
    connected: false,
    model: null,
    error: null,
  });
  const threadRef = useRef<HTMLDivElement>(null);

  const activeChat = chats.find((c) => c.id === activeChatId) ?? null;

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

      // Create or use existing chat
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

  const hasMessages = activeChat && activeChat.messages.length > 0;

  return (
    <div className="app">
      <Sidebar
        chats={chats}
        activeChatId={activeChatId}
        onSelectChat={handleSelectChat}
        onNewChat={handleNewChat}
        onDeleteChat={handleDeleteChat}
      />
      <div className="chat-panel">
        <div className="chat-header">
          <div
            className={`chat-header-dot ${connection.connected ? '' : 'chat-header-dot--off'}`}
            title={connection.connected ? `Connected · ${connection.model}` : 'Not connected'}
          />
          <div className="chat-header-title">HR Business Partner Agent</div>
          {connection.connected && (
            <span className="connection-badge">{connection.model}</span>
          )}
          {activeChat?.route && <span className="route-badge">{activeChat.route}</span>}
          <div style={{ flex: 1 }} />
          {!connection.connected && (
            <button className="setup-hint" onClick={() => setSettingsOpen(true)}>
              {getApiKey() ? 'Connection failed — check key' : 'Set up API key to start'}
            </button>
          )}
          <button
            className="settings-btn"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
          >
            &#9881;
          </button>
        </div>

        {hasMessages ? (
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
        ) : (
          <Welcome onSend={handleSend} disabled={responding} />
        )}

        {error && (
          <div className="chat-error">
            {error}
          </div>
        )}

        {hasMessages && <ChatInput onSend={handleSend} disabled={responding} />}
      </div>

      <Settings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onStatusChange={setConnection}
      />
    </div>
  );
}
