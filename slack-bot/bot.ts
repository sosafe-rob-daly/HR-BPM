import bolt from '@slack/bolt';
const { App } = bolt;

// ── Environment ─────────────────────────────────────────────────────

const SLACK_BOT_TOKEN = env('SLACK_BOT_TOKEN');
const SLACK_SIGNING_SECRET = env('SLACK_SIGNING_SECRET');
const SLACK_APP_TOKEN = env('SLACK_APP_TOKEN');
const OPENAI_API_KEY = env('OPENAI_API_KEY');

// Confluence (for group membership check)
const CONFLUENCE_EMAIL = process.env.CONFLUENCE_EMAIL ?? '';
const CONFLUENCE_TOKEN = process.env.CONFLUENCE_TOKEN ?? '';
const CONFLUENCE_BASE_URL = (process.env.CONFLUENCE_BASE_URL ?? '').replace(/\/+$/, '');

// Manual email aliases: "slack-email:confluence-email,slack-email2:confluence-email2"
const EMAIL_ALIASES_RAW = process.env.EMAIL_ALIASES ?? '';

function env(name: string): string {
  const val = process.env[name];
  if (!val) { console.error(`Missing ${name}`); process.exit(1); }
  return val;
}

// ── OpenAI config ───────────────────────────────────────────────────

const OPENAI_BASE = 'https://api.openai.com/v1';
const MODEL = 'gpt-4o';

// Dual-tier assistant IDs (placeholder — paste real IDs after running setup-assistants.ts)
const ASSISTANT_IDS = {
  escalation: 'asst_ILlD4D0iWja22rEpFx1Z1cHV',
  general: {
    performance: 'asst_rv5KDbupjOttcqsJqDSZRorg',
    conversation: 'asst_Wznw66uGX2shOz5JhulLcqjV',
    policy: 'asst_EezRSJ435MMhpvJWKL8i8rCd',
    separation: 'asst_g74hv9Gq5aECXp2SCAVWsdx1',
  },
  manager: {
    performance: 'asst_DLZKrLJYfdESX27RtY5FkbbG',
    conversation: 'asst_Pa81conwymSnxuaMjVxTLJRW',
    policy: 'asst_gylPFYTBBaAARzbp3anuC2Zw',
    separation: 'asst_tKTquBvJ8afrtW1XXU2lajBV',
  },
};

type UserRole = 'general' | 'manager';
type DomainRoute = 'performance' | 'conversation' | 'policy' | 'separation';

function getAssistantId(route: string, role: UserRole): string {
  if (route === 'escalation') return ASSISTANT_IDS.escalation;
  const tier = ASSISTANT_IDS[role];
  return tier[route as DomainRoute] ?? tier.policy;
}

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

// ── Manager group membership ────────────────────────────────────────

let managerEmails = new Set<string>();
let managerGroupLastRefresh = 0;
const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

// Email alias map: slack email → confluence email
const emailAliases = new Map<string, string>();

function loadEmailAliases() {
  if (!EMAIL_ALIASES_RAW) return;
  for (const pair of EMAIL_ALIASES_RAW.split(',')) {
    const [from, to] = pair.split(':').map((s) => s.trim().toLowerCase());
    if (from && to) emailAliases.set(from, to);
  }
  if (emailAliases.size > 0) {
    console.log(`  Loaded ${emailAliases.size} email aliases`);
  }
}

async function refreshManagerGroup() {
  if (!CONFLUENCE_EMAIL || !CONFLUENCE_TOKEN || !CONFLUENCE_BASE_URL) {
    console.log('[role] Confluence credentials not set — all users get general tier');
    return;
  }

  const now = Date.now();
  if (now - managerGroupLastRefresh < REFRESH_INTERVAL_MS && managerEmails.size > 0) return;

  console.log('[role] Refreshing team-leadership group membership...');
  const auth = Buffer.from(`${CONFLUENCE_EMAIL}:${CONFLUENCE_TOKEN}`).toString('base64');
  const emails = new Set<string>();
  let startAt = 0;
  const maxResults = 50;

  try {
    while (true) {
      const res = await fetch(
        `${CONFLUENCE_BASE_URL}/rest/api/latest/group/member?groupname=team-leadership&limit=${maxResults}&startAt=${startAt}`,
        { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } },
      );

      if (!res.ok) {
        console.error(`[role] Failed to fetch group: ${res.status}`);
        break;
      }

      const data = (await res.json()) as {
        values: { emailAddress?: string }[];
        isLast: boolean;
        total: number;
      };

      for (const member of data.values) {
        if (member.emailAddress) {
          emails.add(member.emailAddress.toLowerCase());
        }
      }

      if (data.isLast) break;
      startAt += maxResults;
    }

    managerEmails = emails;
    managerGroupLastRefresh = now;
    console.log(`[role] Loaded ${managerEmails.size} manager emails`);
  } catch (err) {
    console.error('[role] Error refreshing group:', err);
  }
}

function isManager(email: string): boolean {
  const normalized = email.toLowerCase();
  if (managerEmails.has(normalized)) return true;

  // Check aliases
  const aliased = emailAliases.get(normalized);
  if (aliased && managerEmails.has(aliased)) return true;

  return false;
}

// Slack user ID → email cache
const userEmailCache = new Map<string, string>();

async function getUserEmail(client: bolt.WebClient, userId: string): Promise<string | null> {
  if (userEmailCache.has(userId)) return userEmailCache.get(userId)!;

  try {
    const result = await client.users.info({ user: userId });
    const email = result.user?.profile?.email;
    if (email) {
      userEmailCache.set(userId, email.toLowerCase());
      return email.toLowerCase();
    }
  } catch (err) {
    console.error(`[role] Failed to get email for ${userId}:`, err);
  }

  return null;
}

async function getUserRole(client: bolt.WebClient, userId: string): Promise<UserRole> {
  await refreshManagerGroup();

  const email = await getUserEmail(client, userId);
  if (!email) {
    console.log(`[role] No email for ${userId} — defaulting to general`);
    return 'general';
  }

  const role = isManager(email) ? 'manager' : 'general';
  console.log(`[role] ${email} → ${role}`);
  return role;
}

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
    body: JSON.stringify({ assistant_id: assistantId, temperature: 0.2 }),
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
  const raw = textBlock?.text?.value ?? '';
  return raw.replace(/【\d+:\d+†[^】]*】/g, '');
}

// ── Slack app ───────────────────────────────────────────────────────

const app = new App({
  token: SLACK_BOT_TOKEN,
  signingSecret: SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: SLACK_APP_TOKEN,
});

// Handle DMs
app.message(async ({ message, say, client }) => {
  if ('subtype' in message) return;
  if (!('text' in message) || !message.text) return;
  if ('bot_id' in message) return;

  const userId = (message as { user: string }).user;
  console.log(`[processing] ${message.text} (user: ${userId})`);

  const channel = message.channel;
  const threadTs = ('thread_ts' in message ? message.thread_ts : message.ts) as string;

  const progress = await say({ text: ':hourglass_flowing_sand: Classifying your question...', thread_ts: threadTs });
  const progressTs = (progress as { ts: string }).ts;

  const updateProgress = async (text: string) => {
    await client.chat.update({ channel, ts: progressTs, text });
  };

  try {
    // Determine user role
    const role = await getUserRole(client, userId);

    const { route } = await classify(message.text);
    const emoji = ROUTE_EMOJI[route] ?? ':brain:';
    const roleLabel = role === 'manager' ? ' :star:' : '';
    await updateProgress(`${emoji} Routed to ${ROUTE_LABELS[route] ?? route}${roleLabel} — generating response...`);

    const assistantId = getAssistantId(route, role);
    let threadId = threadMap.get(threadTs);
    if (!threadId) {
      threadId = await createThread();
      threadMap.set(threadTs, threadId);
    }

    await addMessage(threadId, message.text);
    const runId = await createRun(threadId, assistantId);
    await waitForRun(threadId, runId);
    const response = await getLastMessage(threadId);

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

  const userId = event.user;
  const channel = event.channel;
  const threadTs = event.thread_ts ?? event.ts;

  const progress = await say({ text: ':hourglass_flowing_sand: Classifying your question...', thread_ts: threadTs });
  const progressTs = (progress as { ts: string }).ts;

  const updateProgress = async (msg: string) => {
    await client.chat.update({ channel, ts: progressTs, text: msg });
  };

  try {
    const role = await getUserRole(client, userId);

    const { route } = await classify(text);
    const emoji = ROUTE_EMOJI[route] ?? ':brain:';
    const roleLabel = role === 'manager' ? ' :star:' : '';
    await updateProgress(`${emoji} Routed to ${ROUTE_LABELS[route] ?? route}${roleLabel} — generating response...`);

    const assistantId = getAssistantId(route, role);
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
  loadEmailAliases();
  await refreshManagerGroup();
  await app.start();
  console.log('\n⚡ SoSafe HRBP Slack bot is running!\n');
  console.log('  DM me or @mention me in a channel.');
  console.log(`  Manager group: ${managerEmails.size} members loaded.`);
  console.log(`  Email aliases: ${emailAliases.size} configured.\n`);
})();
