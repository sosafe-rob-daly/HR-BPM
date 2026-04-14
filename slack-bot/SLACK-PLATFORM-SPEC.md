# Slack Hosted Platform Migration — Spec & Build Prompt

## What This Is

HR-BPM is SoSafe's internal HR Business Partner agent. It helps people managers with HR questions by routing them to specialist AI agents (escalation triage, performance management, difficult conversations, policy lookup, separation/termination). It uses OpenAI's Assistants API as the brain and Confluence as the knowledge base.

We have a working Slack bot built with `@slack/bolt` (Socket Mode). It works, but requires us to host and run a long-lived Node.js process somewhere. We want to migrate to **Slack's hosted platform** so Slack runs the infrastructure for us.

## Current Architecture (Bolt)

The existing bot (`bot.ts`) does this on every incoming message:

1. **Receive** a DM or @mention
2. **Post** a progress message ("Classifying your question...")
3. **Resolve user role**: Slack user ID → email (via `users.info`) → check against Confluence `team-leadership` group → `'manager' | 'general'`
4. **Classify** the message: POST to OpenAI chat completions with a system prompt that returns `{ route, confidence, reasoning }` as structured JSON
5. **Route** to the correct OpenAI assistant based on `(route, role)` — 10 assistants total: 1 escalation (shared), 4 general-tier domain, 4 manager-tier domain
6. **Run** the assistant: create/reuse thread → add message → create run → poll until complete → get response
7. **Update** the progress message with the final response (prepended with a route emoji)

### Key Data

- **10 OpenAI Assistants** — IDs stored as env vars or constants. Escalation is role-agnostic. The 4 domain agents (performance, conversation, policy, separation) exist in two tiers (general, manager) with different vector stores attached.
- **Classifier model**: `gpt-4o` via chat completions (NOT an assistant — it uses structured JSON output)
- **Thread persistence**: currently an in-memory `Map<slackThreadTs, openaiThreadId>` — must move to Slack datastore
- **Manager group cache**: Confluence `team-leadership` group members (emails), refreshed every 30 min — must move to Slack datastore
- **Email cache**: Slack user ID → email, in-memory — must move to Slack datastore
- **Email aliases**: manual map for users whose Slack email differs from Confluence email, currently from `EMAIL_ALIASES` env var

## Getting Started

The Slack hosted platform uses Deno (not Node.js) and the `deno-slack-sdk`. To bootstrap:

1. **Install the Slack CLI** if not already: `curl -fsSL https://downloads.slack-edge.com/slack-cli/install.sh | bash` (or `brew install slack-cli` on macOS)
2. **Authenticate**: `slack login`
3. **Create the project** inside the existing `slack-bot/` directory. You can either:
   - Scaffold fresh: `slack create hr-bpm-slack --template https://github.com/slack-samples/deno-starter-template` and move files in
   - Or manually create the required files (see structure below)
4. **Key files the Slack CLI expects**:
   - `slack.json` — project metadata (points to manifest)
   - `deno.jsonc` — Deno config (import map, tasks)
   - `manifest.ts` — app definition (scopes, datastores, functions, workflows, triggers)
   - `import_map.ts` — centralized dependency imports from `deno.land/x/deno_slack_sdk` and `deno.land/x/deno_slack_api`
5. **Deploy**: `slack deploy` (pushes to Slack's infrastructure)
6. **Set env vars**: `slack env add OPENAI_API_KEY sk-...` (repeat for each secret)
7. **Add triggers**: `slack trigger create --trigger-def triggers/message_trigger.ts`

The Slack platform SDK docs: https://api.slack.com/automation
Deno Slack SDK: https://github.com/slackapi/deno-slack-sdk
Starter template: https://github.com/slack-samples/deno-starter-template

## Target Architecture (Slack Hosted Platform)

### Directory Structure

```
slack-bot/
  manifest.ts          — app manifest (scopes, datastores, bot user)
  slack.json           — Slack CLI project config
  functions/
    handle_message.ts  — main function: classify → resolve role → run assistant → respond
  datastores/
    threads.ts         — OpenAI thread ID per Slack thread
    manager_cache.ts   — manager email set + last refresh timestamp
    email_cache.ts     — Slack user ID → email
  lib/
    openai.ts          — pure OpenAI API functions (classify, thread ops, run ops)
    confluence.ts      — pure Confluence API functions (group membership)
    roles.ts           — role resolution logic (email lookup, alias check, manager check)
    constants.ts       — assistant IDs, route labels, emojis, config
  triggers/
    message_trigger.ts — event trigger for messages/mentions
```

### Manifest

The manifest needs:
- **Bot scopes**: `chat:write`, `users:read`, `users:read.email`, `app_mentions:read`, `im:read`, `im:write`, `im:history`
- **Datastores**: `threads`, `manager_cache`, `email_cache`
- **Functions**: `handle_message`
- **Workflows**: `message_workflow` (triggered by message events, calls `handle_message`)
- **Event triggers**: `message_posted` in DMs and channels where the bot is mentioned

### Datastores

**threads** — maps Slack thread timestamps to OpenAI thread IDs
```
primary_key: thread_ts (string)
attributes:
  openai_thread_id: string
  created_at: number
```

**manager_cache** — single-row store for the manager email set
```
primary_key: cache_key (string, always "managers")
attributes:
  emails: string  (JSON array of lowercase emails)
  last_refresh: number (epoch ms)
```

**email_cache** — maps Slack user IDs to email addresses
```
primary_key: slack_user_id (string)
attributes:
  email: string
```

### Environment Variables (Secrets)

Set via `slack env add`:
- `OPENAI_API_KEY`
- `CONFLUENCE_EMAIL`
- `CONFLUENCE_TOKEN`
- `CONFLUENCE_BASE_URL`
- `EMAIL_ALIASES` (optional, format: `slack@email:confluence@email,slack2@email:confluence2@email`)

Assistant IDs should also be env vars (not hardcoded) so they survive redeployment:
- `ASSISTANT_ID_ESCALATION`
- `ASSISTANT_ID_GENERAL_PERFORMANCE`
- `ASSISTANT_ID_GENERAL_CONVERSATION`
- `ASSISTANT_ID_GENERAL_POLICY`
- `ASSISTANT_ID_GENERAL_SEPARATION`
- `ASSISTANT_ID_MANAGER_PERFORMANCE`
- `ASSISTANT_ID_MANAGER_CONVERSATION`
- `ASSISTANT_ID_MANAGER_POLICY`
- `ASSISTANT_ID_MANAGER_SEPARATION`

### Function: handle_message

This is the core function. Pseudocode:

```
input: { channel_id, thread_ts, user_id, text, message_ts }

1. Post progress message: "Classifying your question..."
2. Resolve role:
   a. Check email_cache datastore for user_id → email
   b. If miss, call Slack client.users.info(user_id), store in datastore
   c. Check manager_cache datastore — if stale (>30 min), refresh from Confluence
   d. Check if email is in manager set (direct match or alias)
   e. Return 'manager' | 'general'
3. Classify: POST to OpenAI /chat/completions with classifier prompt + structured JSON schema
4. Update progress message with route emoji + "generating response..."
5. Get/create OpenAI thread:
   a. Check threads datastore for thread_ts
   b. If miss, create new thread via OpenAI API, store in datastore
6. Add user message to thread
7. Create run with the correct assistant ID for (route, role)
8. Poll run status until completed (with timeout)
9. Get last assistant message, strip citation markers
10. Update progress message with final response
11. On error: update progress message with warning
```

## OpenAI API Functions to Port

These are pure HTTP functions — no Slack or Deno dependencies. Just `fetch()`.

### Classifier
```typescript
// POST https://api.openai.com/v1/chat/completions
// model: gpt-4o
// messages: [{ role: 'system', content: CLASSIFIER_PROMPT }, { role: 'user', content: text }]
// response_format: { type: 'json_schema', json_schema: { name: 'classification', strict: true, schema: { ... } } }
// Returns: { route: string, confidence: string, reasoning: string }
```

### Thread operations
```typescript
// Create thread: POST https://api.openai.com/v1/threads  (body: {})
// Add message:   POST https://api.openai.com/v1/threads/{id}/messages  (body: { role: 'user', content: text })
// Create run:    POST https://api.openai.com/v1/threads/{id}/runs  (body: { assistant_id: id })
// Poll run:      GET  https://api.openai.com/v1/threads/{id}/runs/{id}  (check status field)
// Get messages:  GET  https://api.openai.com/v1/threads/{id}/messages?order=desc&limit=1
```

All OpenAI calls need headers:
```
Authorization: Bearer {OPENAI_API_KEY}
Content-Type: application/json
OpenAI-Beta: assistants=v2
```

### Citation stripping
Response text has citation markers like `【12:4†source】` — strip with:
```typescript
text.replace(/【\d+:\d+†[^】]*】/g, '')
```

## Confluence API Functions to Port

### Fetch team-leadership group members
```
GET {CONFLUENCE_BASE_URL}/rest/api/latest/group/member?groupname=team-leadership&limit=50&startAt={n}
Authorization: Basic {base64(email:token)}
Accept: application/json

Response: { values: [{ emailAddress: string }], isLast: boolean, total: number }
```
Paginate until `isLast === true`. Collect all `emailAddress` values, lowercase.

## Route Configuration

```typescript
const ROUTE_EMOJI = {
  escalation: ':rotating_light:',
  performance: ':chart_with_upwards_trend:',
  conversation: ':speech_balloon:',
  policy: ':book:',
  separation: ':handshake:',
};

const ROUTE_LABELS = {
  escalation: 'Escalation triage',
  performance: 'Performance management',
  conversation: 'Difficult conversations',
  policy: 'Policy & process',
  separation: 'Separation & termination',
};
```

## Classifier Prompt

(Exact copy — do not modify)

```
You are the intake router for SoSafe's HR Business Partner agent. Your only job is to read a people manager's message and route it to the correct specialist agent. You do not answer HR questions yourself.

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

Respond with ONLY a JSON object: {"route": "...", "confidence": "high|medium|low", "reasoning": "..."}
```

Classifier JSON schema:
```json
{
  "type": "json_schema",
  "json_schema": {
    "name": "classification",
    "strict": true,
    "schema": {
      "type": "object",
      "properties": {
        "route": { "type": "string", "enum": ["escalation", "separation", "performance", "conversation", "policy"] },
        "confidence": { "type": "string", "enum": ["high", "medium", "low"] },
        "reasoning": { "type": "string" }
      },
      "required": ["route", "confidence", "reasoning"],
      "additionalProperties": false
    }
  }
}
```

## Important Behavior Notes

- **Progress messages**: The bot posts an initial message ("Classifying...") and then *updates* it with the response. It does NOT post a new message. Use `chat.update`, not `chat.postMessage` for the final response.
- **Thread replies**: All responses go in the thread (use `thread_ts`).
- **Role badge**: When user is a manager, append a `:star:` to the route label in the progress update.
- **Empty mentions**: If someone @mentions the bot with no text, reply with "Hi! Describe a people situation and I'll help."
- **Bot messages**: Ignore messages from bots and message subtypes (edits, joins, etc.).
- **Error handling**: On any error, update the progress message to `:warning: Sorry, I ran into an issue: {error message}`.
- **Run polling**: Poll every 1 second, timeout after 60 iterations. Handle `failed`, `cancelled`, `expired` statuses.

## What NOT to Change

- Do not modify the classifier prompt or schema
- Do not modify assistant IDs or routing logic
- Do not change the OpenAI API call patterns (Assistants v2)
- Do not add new features — this is a 1:1 port of the existing Bolt bot

## Testing

After building:
1. `slack deploy` to push to Slack's infrastructure
2. DM the bot — should classify and respond
3. @mention in a channel — same behavior
4. Check datastore persistence: send a follow-up message in the same thread — should reuse the OpenAI thread
5. Verify role resolution: check logs for `[role] email → manager/general`
