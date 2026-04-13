import bolt from '@slack/bolt';
const { App } = bolt;

// ── Environment ─────────────────────────────────────────────────────

const SLACK_BOT_TOKEN = env('SLACK_BOT_TOKEN');
const SLACK_SIGNING_SECRET = env('SLACK_SIGNING_SECRET');
const SLACK_APP_TOKEN = env('SLACK_APP_TOKEN');
const OPENAI_API_KEY = env('OPENAI_API_KEY');

function env(name: string): string {
  const val = process.env[name];
  if (!val) { console.error(`Missing ${name}`); process.exit(1); }
  return val;
}

// ── OpenAI config ───────────────────────────────────────────────────

const OPENAI_BASE = 'https://api.openai.com/v1';
const MODEL = 'gpt-4o';

const ASSISTANT_IDS: Record<string, string> = {
  escalation: 'asst_5Bn4Y1vuUHpvj7ZT62XCnT6m',
  performance: 'asst_2nIW1O6mMYuGgTWpEymi0Rjx',
  conversation: 'asst_W1dO5e9e4dzgbWNZ7VnH20ms',
  policy: 'asst_kIEWkZwnh15NC7ikKM9opkVd',
  separation: 'asst_4E77rMdBHx3c4Bkmoq1smqMl',
};

const ROUTE_EMOJI: Record<string, string> = {
  escalation: ':rotating_light:',
  performance: ':chart_with_upwards_trend:',
  conversation: ':speech_balloon:',
  policy: ':book:',
  separation: ':handshake:',
};

const ROUTE_LABELS: Record<string, string> = {
  escalation: 'Escalation triage',
  performance: 'Performance management',
  conversation: 'Difficult conversations',
  policy: 'Policy & process',
  separation: 'Separation & termination',
};

// ── Classifier prompt ───────────────────────────────────────────────

const CLASSIFIER_PROMPT = `You are the intake router for SoSafe's HR Business Partner agent. Your only job is to read a people manager's message and route it to the correct specialist agent. You do not answer HR questions yourself.

Evaluate every incoming message against these categories in this priority order. Priority matters — if a message matches Escalation, route there even if it also matches another category.

1. ESCALATION TRIAGE → "escalation"
Route here when the message contains any of:
- Allegations of harassment, discrimination, bullying, or retaliation
- Mention of legal action, lawyers, or formal complaints
- Whistleblowing or ethics violations
- Threats of self-harm or harm to others
- Employee mentions of protected characteristics in a conflict context
- Any situation where getting it wrong creates legal liability

When in doubt between Escalation and another category, choose Escalation.

2. SEPARATION & TERMINATION → "separation"
Route here when the message is about ending employment, separation agreements, termination, redundancy, or contract non-renewal.

3. PERFORMANCE MANAGEMENT → "performance"
Route here when the message is about PIPs, underperformance, probation, reviews, or warnings.

4. DIFFICULT CONVERSATIONS → "conversation"
Route here when the message is about preparing for tough feedback, conflict, delivering bad news, or coaching on communication.

5. POLICY & PROCESS LOOKUP → "policy"
Route here when the message is about leave, benefits, onboarding, "what's the policy on X", HR systems, or working arrangements.

If truly ambiguous, route to "policy" as the safest default.

Respond with ONLY a JSON object: {"route": "...", "confidence": "high|medium|low", "reasoning": "..."}`;

const classifierSchema = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'classification',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        route: { type: 'string', enum: ['escalation', 'separation', 'performance', 'conversation', 'policy'] },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        reasoning: { type: 'string' },
      },
      required: ['route', 'confidence', 'reasoning'],
      additionalProperties: false,
    },
  },
};

// ── OpenAI helpers ──────────────────────────────────────────────────

function oaiHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: `Bearer ${OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
    'OpenAI-Beta': 'assistants=v2',
    ...extra,
  };
}

async function oaiJson(path: string, options: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${OPENAI_BASE}${path}`, {
    ...options,
    headers: { ...oaiHeaders(), ...(options.headers as Record<string, string> ?? {}) },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI ${res.status}: ${err}`);
  }
  return res.json();
}

// ── Classifier ──────────────────────────────────────────────────────

interface ClassifierResult { route: string; confidence: string; reasoning: string; }

async function classify(text: string): Promise<ClassifierResult> {
  const data = await oaiJson('/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: CLASSIFIER_PROMPT },
        { role: 'user', content: text },
      ],
      response_format: classifierSchema,
    }),
  }) as { choices: { message: { content: string } }[] };

  return JSON.parse(data.choices[0].message.content);
}

// ── Assistants API ──────────────────────────────────────────────────

// Thread cache: Slack thread_ts → OpenAI thread_id
const threadMap = new Map<string, string>();

async function createThread(): Promise<string> {
  const data = await oaiJson('/threads', { method: 'POST', body: '{}' }) as { id: string };
  return data.id;
}

async function addMessage(threadId: string, content: string) {
  await oaiJson(`/threads/${threadId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ role: 'user', content }),
  });
}

async function createRun(threadId: string, assistantId: string): Promise<string> {
  const data = await oaiJson(`/threads/${threadId}/runs`, {
    method: 'POST',
    body: JSON.stringify({ assistant_id: assistantId }),
  }) as { id: string };
  return data.id;
}

async function waitForRun(threadId: string, runId: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const data = await oaiJson(`/threads/${threadId}/runs/${runId}`) as {
      status: string;
      last_error?: { message: string };
    };
    if (data.status === 'completed') return;
    if (data.status === 'failed') throw new Error(data.last_error?.message ?? 'Run failed');
    if (data.status === 'cancelled' || data.status === 'expired') throw new Error(`Run ${data.status}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Run timed out');
}

async function getLastMessage(threadId: string): Promise<string> {
  const data = await oaiJson(`/threads/${threadId}/messages?order=desc&limit=1`) as {
    data: { role: string; content: { type: string; text?: { value: string } }[] }[];
  };
  const msg = data.data[0];
  if (!msg || msg.role !== 'assistant') throw new Error('No assistant response');
  const textBlock = msg.content.find((c) => c.type === 'text');
  // Strip OpenAI citation markers like 【4:0†source】
  const raw = textBlock?.text?.value ?? '';
  return raw.replace(/【\d+:\d+†[^】]*】/g, '');
}

// ── Core: handle a message ──────────────────────────────────────────

async function handleMessage(text: string, slackThreadTs: string): Promise<{ response: string; route: string }> {
  // 1. Classify
  const { route } = await classify(text);
  const assistantId = ASSISTANT_IDS[route] ?? ASSISTANT_IDS.policy;

  // 2. Get or create OpenAI thread (keyed by Slack thread)
  let threadId = threadMap.get(slackThreadTs);
  if (!threadId) {
    threadId = await createThread();
    threadMap.set(slackThreadTs, threadId);
  }

  // 3. Run the assistant
  await addMessage(threadId, text);
  const runId = await createRun(threadId, assistantId);
  await waitForRun(threadId, runId);

  // 4. Get response
  const response = await getLastMessage(threadId);
  return { response, route };
}

// ── Slack app ───────────────────────────────────────────────────────

const app = new App({
  token: SLACK_BOT_TOKEN,
  signingSecret: SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: SLACK_APP_TOKEN,
});

// Log all events for debugging
app.use(async ({ body, next }) => {
  console.log('[event]', body.event?.type ?? body.type ?? 'unknown');
  await next();
});

// Handle DMs
app.message(async ({ message, say, client }) => {
  // Only handle actual user messages (not bot messages, edits, subtypes)
  if ('subtype' in message) return;
  if (!('text' in message) || !message.text) return;
  if ('bot_id' in message) return;
  console.log('[processing]', message.text);

  const channel = message.channel;
  const threadTs = ('thread_ts' in message ? message.thread_ts : message.ts) as string;

  // Post a progress message we'll update as we go
  const progress = await say({ text: ':hourglass_flowing_sand: Classifying your question...', thread_ts: threadTs });
  const progressTs = (progress as { ts: string }).ts;

  const updateProgress = async (text: string) => {
    await client.chat.update({ channel, ts: progressTs, text });
  };

  try {
    const { route } = await classify(message.text);
    const emoji = ROUTE_EMOJI[route] ?? ':brain:';
    await updateProgress(`${emoji} Routed to ${ROUTE_LABELS[route] ?? route} — generating response...`);

    const assistantId = ASSISTANT_IDS[route] ?? ASSISTANT_IDS.policy;
    let threadId = threadMap.get(threadTs);
    if (!threadId) {
      threadId = await createThread();
      threadMap.set(threadTs, threadId);
    }

    await addMessage(threadId, message.text);
    const runId = await createRun(threadId, assistantId);
    await waitForRun(threadId, runId);
    const response = await getLastMessage(threadId);

    // Replace progress message with the final response
    await updateProgress(`${emoji} ${response}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Something went wrong';
    console.error('Error handling message:', msg);
    await updateProgress(`:warning: Sorry, I ran into an issue: ${msg}`);
  }
});

// Handle @mentions in channels
app.event('app_mention', async ({ event, say, client }) => {
  const text = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();
  if (!text) {
    await say({ text: "Hi! Describe a people situation and I'll help.", thread_ts: event.ts });
    return;
  }

  const channel = event.channel;
  const threadTs = event.thread_ts ?? event.ts;

  const progress = await say({ text: ':hourglass_flowing_sand: Classifying your question...', thread_ts: threadTs });
  const progressTs = (progress as { ts: string }).ts;

  const updateProgress = async (msg: string) => {
    await client.chat.update({ channel, ts: progressTs, text: msg });
  };

  try {
    const { route } = await classify(text);
    const emoji = ROUTE_EMOJI[route] ?? ':brain:';
    await updateProgress(`${emoji} Routed to ${ROUTE_LABELS[route] ?? route} — generating response...`);

    const assistantId = ASSISTANT_IDS[route] ?? ASSISTANT_IDS.policy;
    let threadId = threadMap.get(threadTs);
    if (!threadId) {
      threadId = await createThread();
      threadMap.set(threadTs, threadId);
    }

    await addMessage(threadId, text);
    const runId = await createRun(threadId, assistantId);
    await waitForRun(threadId, runId);
    const response = await getLastMessage(threadId);

    await updateProgress(`${emoji} ${response}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Something went wrong';
    console.error('Error handling mention:', msg);
    await updateProgress(`:warning: Sorry, I ran into an issue: ${msg}`);
  }
});

// ── Start ───────────────────────────────────────────────────────────

(async () => {
  await app.start();
  console.log('\n⚡ SoSafe HRBP Slack bot is running!\n');
  console.log('  DM me or @mention me in a channel.\n');
})();
