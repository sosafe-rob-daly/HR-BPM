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
import { ASSISTANT_IDS } from './assistants';

const OPENAI_BASE = 'https://api.openai.com/v1';
const MODEL = 'gpt-4o';

const ROUTE_LABELS: Record<string, string> = {
  escalation: 'Escalation triage',
  performance: 'Performance management',
  conversation: 'Difficult conversations',
  policy: 'Policy & process',
  separation: 'Separation & termination',
};

// ── API key management ──────────────────────────────────────────────

const STORAGE_KEY = 'hr-bpm-openai-key';

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
          enum: ['escalation', 'separation', 'performance', 'conversation', 'policy'],
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

async function createRun(threadId: string, assistantId: string): Promise<string> {
  const data = await openAiJson(`/threads/${threadId}/runs`, {
    method: 'POST',
    body: JSON.stringify({ assistant_id: assistantId }),
  }) as { id: string };
  return data.id;
}

async function waitForRun(threadId: string, runId: string): Promise<void> {
  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    const data = await openAiJson(`/threads/${threadId}/runs/${runId}`) as {
      status: string;
      last_error?: { message: string };
    };

    if (data.status === 'completed') return;
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

const THREAD_STORAGE_KEY = 'hr-bpm-threads';

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
  const assistantId = ASSISTANT_IDS[route as keyof typeof ASSISTANT_IDS]
    ?? ASSISTANT_IDS.policy;

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

// ── Build conversation history from our message format ──────────────

export function buildHistory(
  messages: { role: 'user' | 'agent'; content: string }[],
): { role: string; content: string }[] {
  return messages.map((m) => ({
    role: m.role === 'agent' ? 'assistant' : 'user',
    content: m.content,
  }));
}
