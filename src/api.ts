const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o';

// ── System prompts (embedded from prompts/*.md) ─────────────────────

import { CLASSIFIER_PROMPT } from './prompts/classifier';
import { ESCALATION_PROMPT } from './prompts/escalation';
import { PERFORMANCE_PROMPT } from './prompts/performance';
import { CONVERSATION_PROMPT } from './prompts/conversation';
import { POLICY_PROMPT } from './prompts/policy';
import { SEPARATION_PROMPT } from './prompts/separation';

const AGENT_PROMPTS: Record<string, string> = {
  escalation: ESCALATION_PROMPT,
  performance: PERFORMANCE_PROMPT,
  conversation: CONVERSATION_PROMPT,
  conversations: CONVERSATION_PROMPT,
  policy: POLICY_PROMPT,
  separation: SEPARATION_PROMPT,
};

const ROUTE_LABELS: Record<string, string> = {
  escalation: 'Escalation triage',
  performance: 'Performance management',
  conversation: 'Difficult conversations',
  conversations: 'Difficult conversations',
  policy: 'Policy & process',
  separation: 'Separation & termination',
};

// ── API key management ──────────────────────────────────────────────

const STORAGE_KEY = 'hr-bpm-openai-key';

export function getApiKey(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function setApiKey(key: string) {
  localStorage.setItem(STORAGE_KEY, key);
}

export function clearApiKey() {
  localStorage.removeItem(STORAGE_KEY);
}

// ── Classifier schema for structured output ─────────────────────────

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
        confidence: {
          type: 'string',
          enum: ['high', 'medium', 'low'],
        },
        reasoning: { type: 'string' },
      },
      required: ['route', 'confidence', 'reasoning'],
      additionalProperties: false,
    },
  },
};

// ── Types ───────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

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

// ── Core API call ───────────────────────────────────────────────────

async function callOpenAI(
  messages: ChatMessage[],
  responseFormat?: typeof classifierSchema,
): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('No API key configured');

  const body: Record<string, unknown> = {
    model: MODEL,
    messages,
  };
  if (responseFormat) {
    body.response_format = responseFormat;
  }

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      err?.error?.message ?? `OpenAI API error: ${res.status}`,
    );
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

// ── Public: send a message through the full workflow ────────────────

export async function sendMessage(
  userMessage: string,
  conversationHistory: ChatMessage[],
): Promise<AgentResponse> {
  // Step 1: Classify
  const classifierMessages: ChatMessage[] = [
    { role: 'system', content: CLASSIFIER_PROMPT },
    ...conversationHistory,
    { role: 'user', content: userMessage },
  ];

  const classifierRaw = await callOpenAI(classifierMessages, classifierSchema);
  const classification: ClassifierResult = JSON.parse(classifierRaw);

  // Step 2: Route to agent
  const route = classification.route;
  const agentPrompt = AGENT_PROMPTS[route] ?? AGENT_PROMPTS.policy;
  const topic = ROUTE_LABELS[route] ?? 'General HR guidance';

  const agentMessages: ChatMessage[] = [
    { role: 'system', content: agentPrompt },
    ...conversationHistory,
    { role: 'user', content: userMessage },
  ];

  const agentContent = await callOpenAI(agentMessages);

  return {
    content: agentContent,
    route,
    topic,
    confidence: classification.confidence,
  };
}

// ── Build conversation history from our message format ──────────────

export function buildHistory(
  messages: { role: 'user' | 'agent'; content: string }[],
): ChatMessage[] {
  return messages.map((m) => ({
    role: m.role === 'agent' ? ('assistant' as const) : ('user' as const),
    content: m.content,
  }));
}
