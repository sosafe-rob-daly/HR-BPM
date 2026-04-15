export interface Message {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: Date;
  sources?: Source[];
  flags?: MessageFlag[];
}

export interface Source {
  title: string;
  lastUpdated?: string;
}

export interface MessageFlag {
  type: 'time-sensitive' | 'escalate';
  label: string;
}

export interface SavedChat {
  id: string;
  title: string;
  messages: Message[];
  topic: string | null;
  route: string | null;
  slashCommand: string | null;
  updatedAt: number;
}

export interface SlashCommandDef {
  id: string;
  label: string;
  description: string;
  icon: string;
}

export interface Conversation {
  messages: Message[];
  topic: string | null;
}
