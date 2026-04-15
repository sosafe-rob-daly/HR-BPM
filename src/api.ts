/**
 * HR-BPM API Layer
 *
 * Uses the OpenAI Assistants API with file search for Confluence-grounded
 * responses. The classifier uses chat completions (no file search needed).
 *
 * STOPGAP: This calls OpenAI directly from the browser with the user's API key.
 * PRODUCTION: Replace with calls to a backend service that uses the OpenAI
 * Agents SDK (see scripts/setup-assistants.ts for the assistant IDs).
 */

import { CLASSIFIER_PROMPT } from './prompts/classifier';
import { getAssistantId } from './assistants';
import type { UserRole } from './assistants';

const OPENAI_BASE = 'https://api.openai.com/v1';
const MODEL = 'gpt-4o';

const ROUTE_LABELS: Record<string, string> = {
  escalation: 'Escalation triage',
  performance: 'Performance management',
  conversation: 'Difficult conversations',
  policy: 'Policy & process',
  separation: 'Separation & termination',
  career: 'Career development',
  feedback: 'Feedback preparation',
};

// ── API key management ──────────────────────────────────────────────

const STORAGE_KEY = 'hr-bpm-openai-key';
const THREAD_STORAGE_KEY = 'hr-bpm-threads';

export function getApiKey(): string | null {
  const key = localStorage.getItem(STORAGE_KEY);
  return key ? key.trim() : null;
}

export function setApiKey(key: string) {
  localStorage.setItem(STORAGE_KEY, key.trim());
}

export function clearApiKey() {
  localStorage.removeItem(STORAGE_KEY);
}

// ── Role management ─────────────────────────────────────────────────

const ROLE_STORAGE_KEY = 'hr-bpm-role';

export function getRole(): UserRole {
  return (localStorage.getItem(ROLE_STORAGE_KEY) as UserRole) ?? 'general';
}

export function setRole(role: UserRole) {
  localStorage.setItem(ROLE_STORAGE_KEY, role);
  // Clear thread cache since threads are tied to specific assistants
  localStorage.removeItem(THREAD_STORAGE_KEY);
}

// ── Connection validation ───────────────────────────────────────────

export interface ConnectionStatus {
  connected: boolean;
  model: string | null;
  error: string | null;
}

export async function validateConnection(): Promise<ConnectionStatus> {
  const apiKey = getApiKey();
  if (!apiKey) return { connected: false, model: null, error: 'No API key' };

  try {
    const res = await fetch(`${OPENAI_BASE}/models/${MODEL}`, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (res.ok) return { connected: true, model: MODEL, error: null };
    if (res.status === 401) return { connected: false, model: null, error: 'Invalid API key' };
    return { connected: false, model: null, error: `API error: ${res.status}` };
  } catch {
    return { connected: false, model: null, error: 'Network error' };
  }
}

// ── Types ───────────────────────────────────────────────────────────

interface ClassifierResult {
  route: string;
  confidence: string;
  reasoning: string;
}

export interface AgentResponse {
  content: string;
  route: string;
  topic: string;
  confidence: string;
}

// ── OpenAI helpers ──────────────────────────────────────────────────

function headers(extra?: Record<string, string>): Record<string, string> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('No API key configured');
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'OpenAI-Beta': 'assistants=v2',
    ...extra,
  };
}

async function openAiJson(path: string, options: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${OPENAI_BASE}${path}`, {
    ...options,
    cache: 'no-store',
    headers: { ...headers(), ...(options.headers as Record<string, string> ?? {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: { message?: string } })?.error?.message ?? `OpenAI API error: ${res.status}`);
  }
  return res.json();
}

// ── Classifier (chat completions — no file search needed) ───────────

const classifierSchema = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'classification',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        route: {
          type: 'string',
          enum: ['escalation', 'separation', 'performance', 'conversation', 'policy', 'career', 'feedback'],
        },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        reasoning: { type: 'string' },
      },
      required: ['route', 'confidence', 'reasoning'],
      additionalProperties: false,
    },
  },
};

async function classify(
  userMessage: string,
  history: { role: string; content: string }[],
): Promise<ClassifierResult> {
  const messages = [
    { role: 'system', content: CLASSIFIER_PROMPT },
    ...history,
    { role: 'user', content: userMessage },
  ];

  const data = await openAiJson('/chat/completions', {
    method: 'POST',
    body: JSON.stringify({ model: MODEL, messages, response_format: classifierSchema }),
  }) as { choices: { message: { content: string } }[] };

  return JSON.parse(data.choices[0].message.content);
}

// ── Assistants API (threads + runs) ─────────────────────────────────

async function createThread(): Promise<string> {
  const data = await openAiJson('/threads', { method: 'POST', body: '{}' }) as { id: string };
  return data.id;
}

async function addMessage(threadId: string, content: string, role: 'user' | 'assistant' = 'user') {
  await openAiJson(`/threads/${threadId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ role, content }),
  });
}

// Track active run so it can be cancelled
let activeRun: { threadId: string; runId: string } | null = null;

async function createRun(threadId: string, assistantId: string): Promise<string> {
  const data = await openAiJson(`/threads/${threadId}/runs`, {
    method: 'POST',
    body: JSON.stringify({ assistant_id: assistantId, temperature: 0.2 }),
  }) as { id: string };
  activeRun = { threadId, runId: data.id };
  return data.id;
}

async function waitForRun(threadId: string, runId: string): Promise<void> {
  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    const data = await openAiJson(`/threads/${threadId}/runs/${runId}`) as {
      status: string;
      last_error?: { message: string };
    };

    if (data.status === 'completed') { activeRun = null; return; }
    if (data.status === 'failed') {
      throw new Error(data.last_error?.message ?? 'Assistant run failed');
    }
    if (data.status === 'cancelled' || data.status === 'expired') {
      throw new Error(`Assistant run ${data.status}`);
    }

    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Assistant run timed out');
}

export async function cancelCurrentRun(): Promise<boolean> {
  if (!activeRun) return false;
  const { threadId, runId } = activeRun;
  try {
    await openAiJson(`/threads/${threadId}/runs/${runId}/cancel`, { method: 'POST' });
    return true;
  } catch {
    return false;
  } finally {
    activeRun = null;
  }
}

async function getLastAssistantMessage(threadId: string): Promise<string> {
  const data = await openAiJson(`/threads/${threadId}/messages?order=desc&limit=1`) as {
    data: { role: string; content: { type: string; text?: { value: string } }[] }[];
  };

  const msg = data.data[0];
  if (!msg || msg.role !== 'assistant') throw new Error('No assistant response');

  const textBlock = msg.content.find((c) => c.type === 'text');
  const raw = textBlock?.text?.value ?? '';
  // Strip OpenAI file search citation markers like 【4:0†source】
  return raw.replace(/【\d+:\d+†[^】]*】/g, '');
}

// ── Thread management (per chat) ────────────────────────────────────

function getThreadMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(THREAD_STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function saveThreadId(chatId: string, threadId: string) {
  const map = getThreadMap();
  map[chatId] = threadId;
  localStorage.setItem(THREAD_STORAGE_KEY, JSON.stringify(map));
}

export function getThreadId(chatId: string): string | null {
  return getThreadMap()[chatId] ?? null;
}

// ── Public: send a message through the full workflow ────────────────

export async function sendMessage(
  userMessage: string,
  history: { role: string; content: string }[],
  chatId?: string,
): Promise<AgentResponse> {
  // Step 1: Classify using chat completions
  const classification = await classify(userMessage, history);
  const route = classification.route;
  const topic = ROUTE_LABELS[route] ?? 'General HR guidance';
  const role = getRole();
  const assistantId = getAssistantId(route, role);

  // Step 2: Get or create a thread for this chat
  let threadId: string | null = chatId ? getThreadId(chatId) : null;

  if (!threadId) {
    threadId = await createThread();
    if (chatId) saveThreadId(chatId, threadId);

    // Seed the thread with conversation history
    for (const msg of history) {
      await addMessage(threadId, msg.content, msg.role === 'assistant' ? 'assistant' : 'user');
    }
  }

  // Step 3: Add the user message and run the assistant
  await addMessage(threadId, userMessage);
  const runId = await createRun(threadId, assistantId);
  await waitForRun(threadId, runId);

  // Step 4: Get the response
  const content = await getLastAssistantMessage(threadId);

  return { content, route, topic, confidence: classification.confidence };
}

// ── Slash command: initiate a guided session ───────────────────────

function buildPrimerMessage(command: string, role: UserRole): string {
  const roleLabel = role === 'manager' ? 'a people manager' : 'an individual contributor';
  if (command === 'career') {
    return `The user has initiated a /career session. They are ${roleLabel}. Begin by greeting them warmly and asking what career challenge or growth aspiration they are currently working on. Be exploratory and encouraging.`;
  }
  if (command === 'feedback') {
    return `The user has initiated a /feedback session. They are ${roleLabel}. Begin by greeting them and asking: Who is the feedback for, and what is the context (review cycle, ad-hoc, peer feedback)? Your goal is to help them write effective feedback.`;
  }
  return `The user has initiated a /${command} session. They are ${roleLabel}. Begin by greeting them and understanding their situation.`;
}

export async function sendSlashCommand(
  command: string,
  chatId: string,
): Promise<AgentResponse> {
  const role = getRole();
  const assistantId = getAssistantId(command, role);
  const topic = ROUTE_LABELS[command] ?? 'Guided session';

  // Create a new thread (slash commands always start fresh)
  const threadId = await createThread();
  saveThreadId(chatId, threadId);

  // Send a priming message (visible to assistant, not shown in UI)
  const primer = buildPrimerMessage(command, role);
  await addMessage(threadId, primer);

  // Run the assistant to generate the opening question
  const runId = await createRun(threadId, assistantId);
  await waitForRun(threadId, runId);
  const content = await getLastAssistantMessage(threadId);

  return { content, route: command, topic, confidence: 'high' };
}

// ── Slash command: send a follow-up message (skips classifier) ─────

export async function sendDirectMessage(
  userMessage: string,
  route: string,
  chatId: string,
): Promise<AgentResponse> {
  const role = getRole();
  const assistantId = getAssistantId(route, role);
  const topic = ROUTE_LABELS[route] ?? 'Guided session';

  const threadId = getThreadId(chatId);
  if (!threadId) throw new Error('No thread found for this chat');

  await addMessage(threadId, userMessage);
  const runId = await createRun(threadId, assistantId);
  await waitForRun(threadId, runId);
  const content = await getLastAssistantMessage(threadId);

  return { content, route, topic, confidence: 'high' };
}

// ── Build conversation history from our message format ──────────────

export function buildHistory(
  messages: { role: 'user' | 'agent'; content: string }[],
): { role: string; content: string }[] {
  return messages.map((m) => ({
    role: m.role === 'agent' ? 'assistant' : 'user',
    content: m.content,
  }));
}
