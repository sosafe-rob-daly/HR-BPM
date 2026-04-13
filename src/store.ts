import type { SavedChat, Message } from './types/chat';

const STORAGE_KEY = 'hr-bpm-chats';

function loadAll(): SavedChat[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedChat[];
    return parsed.map((c) => ({
      ...c,
      messages: c.messages.map((m) => ({ ...m, timestamp: new Date(m.timestamp) })),
    }));
  } catch {
    return [];
  }
}

function saveAll(chats: SavedChat[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
}

export function getChats(): SavedChat[] {
  return loadAll().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getChat(id: string): SavedChat | undefined {
  return loadAll().find((c) => c.id === id);
}

export function saveChat(chat: SavedChat) {
  const all = loadAll();
  const idx = all.findIndex((c) => c.id === chat.id);
  if (idx >= 0) {
    all[idx] = chat;
  } else {
    all.push(chat);
  }
  saveAll(all);
}

export function deleteChat(id: string) {
  saveAll(loadAll().filter((c) => c.id !== id));
}

export function createChat(): SavedChat {
  return {
    id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: 'New conversation',
    messages: [],
    topic: null,
    route: null,
    updatedAt: Date.now(),
  };
}

export function titleFromMessages(messages: Message[]): string {
  const first = messages.find((m) => m.role === 'user');
  if (!first) return 'New conversation';
  const text = first.content.slice(0, 50);
  return text.length < first.content.length ? text + '…' : text;
}
