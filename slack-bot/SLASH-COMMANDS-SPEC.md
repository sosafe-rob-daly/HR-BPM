# Slack Guided Flows: /career and /feedback

## Context

The HR-BPM web app now supports guided `/career` and `/feedback` flows. These create a bot-initiated conversation where the assistant asks the user questions and guides them through career development or feedback preparation. We need to replicate this in the Slack bot.

The web app implementation is the reference for how these work. This spec covers only the Slack-specific concerns — the AI brain (prompts, assistants, vector stores) is already built and shared with the web app.

---

## UX Design

### DM-only, not global slash commands

These flows are **only available inside the bot's DM**. We do NOT register global Slack slash commands. Instead, the bot's existing message handler detects when a DM starts with `/career` or `/feedback` and triggers the guided flow.

Reasons:
- Career and feedback conversations are **private by nature** — they belong in a DM, not a channel
- No additional Slack app configuration or scopes needed
- No channel-hopping ("check your DMs!") — you're already talking to the bot
- Simpler implementation — just pattern matching in the existing message handler

### Flow

1. **User DMs the bot** with `/career` or `/feedback` (optionally with additional context, e.g., `/feedback for my peer Alex about Q4`)
2. **Bot posts a progress message** in the DM: "Setting up your career session..."
3. **Bot sends a priming message** to a new OpenAI thread, runs the appropriate assistant
4. **Bot updates the progress message** with the assistant's opening question
5. **All follow-up messages in that DM thread** continue the guided conversation, skipping the classifier
6. Each new `/career` or `/feedback` invocation starts a **new thread** in the DM so multiple sessions stay separated

### What the user sees

```
Bot DM:
  User: /feedback
  Bot: "Hi! I'd love to help you prepare some feedback. Who is the feedback 
       for, and what's the context — is this for a review cycle, ad-hoc, or 
       peer feedback?"
  [user replies in thread]
  User: "I need to write peer feedback for my colleague Alex..."
  Bot: "Got it — tell me about Alex's contributions..."
```

With optional context:
```
Bot DM:
  User: /feedback for my peer Alex about their communication skills
  Bot: "Thanks for the context! Let's build some feedback for Alex about 
       communication skills. Can you tell me about specific situations 
       where you observed this?"
```

---

## Implementation

### Message Handler Changes

In the existing `app.message` handler, add detection **before** the classifier call:

```typescript
app.message(async ({ message, say, client }) => {
  // ... existing subtype/bot filters ...
  
  const text = message.text?.trim() ?? '';
  
  // Detect /career or /feedback commands
  const commandMatch = text.match(/^\/(career|feedback)(?:\s+(.*))?$/i);
  if (commandMatch) {
    const command = commandMatch[1].toLowerCase();  // 'career' or 'feedback'
    const extraContext = commandMatch[2]?.trim() ?? null;  // optional user context
    await handleGuidedFlow(command, extraContext, message, say, client);
    return;  // skip normal classification flow
  }

  // Check if this thread has a stored route (follow-up in a guided session)
  const threadTs = message.thread_ts ?? message.ts;
  const threadInfo = threadMap.get(threadTs);
  if (threadInfo?.route) {
    await handleDirectMessage(text, threadInfo, message, say, client);
    return;  // skip classification
  }

  // ... existing classifier flow ...
});
```

### New Function: handleGuidedFlow

```
async function handleGuidedFlow(command, extraContext, message, say, client):
  1. Post progress message: "⏳ Setting up your {command} session..."
  2. Resolve user role (same getUserRole() flow)
  3. Create new OpenAI thread
  4. Build priming message (see below) — include extraContext if provided
  5. Send priming message to thread, run the assistant
  6. Wait for completion, get response
  7. Update progress message with the assistant's opening question
  8. Store in thread map: message.ts → { threadId, route: command }
```

### New Function: handleDirectMessage

For follow-up messages in a guided session thread (route is already known):

```
async function handleDirectMessage(text, threadInfo, message, say, client):
  1. Post progress message in thread
  2. Resolve user role
  3. Get assistant ID: getAssistantId(threadInfo.route, role)
  4. Add user message to existing OpenAI thread
  5. Run assistant, wait for completion
  6. Update progress message with response
```

### Thread Map Update

Expand the thread map to store the route for guided sessions:

```typescript
// Before:
const threadMap = new Map<string, string>();  // slackThreadTs → openaiThreadId

// After:
interface ThreadInfo {
  threadId: string;
  route?: string;  // set for guided sessions, undefined for classified chats
}
const threadMap = new Map<string, ThreadInfo>();
```

Update all existing thread map reads/writes to use the new structure.

### Priming Messages

These match the web app (from `buildPrimerMessage` in `src/api.ts`):

**Without extra context:**
- Career (manager): "The user has initiated a /career session. They are a people manager. Begin by greeting them warmly and asking what career challenge or growth aspiration they are currently working on. Be exploratory and encouraging."
- Career (IC): Same but "an individual contributor"
- Feedback (manager): "The user has initiated a /feedback session. They are a people manager. Begin by greeting them and asking: Who is the feedback for, and what is the context (review cycle, ad-hoc, peer feedback)? Your goal is to help them write effective feedback."
- Feedback (IC): Same but "an individual contributor"

**With extra context (user typed `/feedback for my peer Alex`):**
Append to the priming message: "The user also provided this context: '{extraContext}'. Use this to skip any questions that are already answered and get straight to helping."

### Assistant IDs

Add career and feedback IDs to the `ASSISTANT_IDS` block in `bot.ts`. These were created by the latest `setup-assistants.ts` run:

```typescript
general: {
  ...existing,
  career: 'asst_Mp0OGqAeDDBBnfz9o1khX5iU',
  feedback: 'asst_XW71vhUrcWcDVEYVUtOvAU3o',
},
manager: {
  ...existing,
  career: 'asst_EPxBrnPZW5eKygrboQAajJzl',
  feedback: 'asst_4Ljtzkd7VkF9Yge3h5G6oFOM',
},
```

### Route Labels and Emoji

Add to the existing maps:

```typescript
const ROUTE_EMOJI = {
  ...existing,
  career: ':compass:',
  feedback: ':pencil:',
};

const ROUTE_LABELS = {
  ...existing,
  career: 'Career development',
  feedback: 'Feedback preparation',
};
```

---

## Edge Cases

1. **User types `/career` in a channel @mention**: Ignore the command prefix — only detect it in DMs. In channels, the message goes through the normal classifier flow (which already routes career questions to the career assistant).

2. **User invokes while a previous session is still running**: Allow it — each invocation creates a new parent message + thread. Old sessions continue to work.

3. **User types `/career` in a thread of an existing conversation**: Treat it as a new guided session — the `/` prefix takes priority over the thread's existing context.

4. **User types just `/`**: Ignore — doesn't match the pattern. Goes through normal classifier.

5. **Case insensitivity**: `/Career`, `/FEEDBACK`, `/Feedback` should all work — the regex uses the `i` flag.

---

## No New Scopes or Configuration

This approach requires **zero changes** to the Slack app configuration:
- No slash command registration
- No new bot scopes
- No reinstallation
- It's just smarter message handling in the existing DM flow

---

## Testing

1. DM the bot with `/career` → verify opening question appears (not classified, uses career assistant)
2. Reply in the thread → verify follow-up uses career assistant (no re-classification)
3. DM with `/feedback for my peer about Q4` → verify context is incorporated into the opening
4. DM with a normal question → verify it still goes through the classifier as before
5. @mention in a channel with `/career` → verify it goes through normal classifier (not treated as command)
6. Toggle role: verify manager gets manager-tier career/feedback responses
7. Start two sessions: `/career` then `/feedback` → verify both threads work independently

---

## Files to Modify

**Bolt version** (`slack-bot/bot.ts`):
- Add command detection at top of `app.message` handler
- Add `handleGuidedFlow()` function
- Add `handleDirectMessage()` function  
- Update thread map type to `Map<string, ThreadInfo>`
- Update all thread map reads/writes for new structure
- Add career + feedback to `ASSISTANT_IDS`, `ROUTE_EMOJI`, `ROUTE_LABELS`
- Add `buildPrimerMessage()` helper

**Slack hosted platform version** (if being built in parallel):
- Same logic in the message handler function
- Thread map uses Slack datastore instead of in-memory Map
