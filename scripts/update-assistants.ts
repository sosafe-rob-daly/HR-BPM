#!/usr/bin/env npx tsx
/**
 * Update existing OpenAI Assistants with latest prompts (Dual Tier)
 *
 * Usage:
 *   export OPENAI_API_KEY="sk-..."
 *   npx tsx scripts/update-assistants.ts
 */

import { ASSISTANT_IDS } from '../src/assistants';
import { ESCALATION_PROMPT } from '../src/prompts/escalation';
import { PERFORMANCE_PROMPT } from '../src/prompts/performance';
import { CONVERSATION_PROMPT } from '../src/prompts/conversation';
import { POLICY_PROMPT } from '../src/prompts/policy';
import { SEPARATION_PROMPT } from '../src/prompts/separation';
import { CAREER_PROMPT } from '../src/prompts/career';
import { FEEDBACK_PROMPT } from '../src/prompts/feedback';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) { console.error('Missing OPENAI_API_KEY'); process.exit(1); }

const domainPrompts: Record<string, string> = {
  performance: PERFORMANCE_PROMPT,
  conversation: CONVERSATION_PROMPT,
  policy: POLICY_PROMPT,
  separation: SEPARATION_PROMPT,
  career: CAREER_PROMPT,
  feedback: FEEDBACK_PROMPT,
};

async function updateAssistant(id: string, instructions: string, label: string) {
  const res = await fetch(`https://api.openai.com/v1/assistants/${id}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
      'OpenAI-Beta': 'assistants=v2',
    },
    body: JSON.stringify({ instructions, temperature: 0.2 }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`    ❌ ${label}: ${res.status} ${err}`);
  } else {
    console.log(`    ✅ ${label}`);
  }
}

async function main() {
  console.log('\n🔄 Updating HR-BPM Assistants (Dual Tier)\n');

  // Shared
  console.log('  Shared:');
  await updateAssistant(ASSISTANT_IDS.escalation, ESCALATION_PROMPT, 'Escalation');

  // General tier
  console.log('\n  General tier:');
  for (const [key, prompt] of Object.entries(domainPrompts)) {
    const id = ASSISTANT_IDS.general[key as keyof typeof ASSISTANT_IDS.general];
    await updateAssistant(id, prompt, `${key} (General)`);
  }

  // Manager tier
  console.log('\n  Manager tier:');
  for (const [key, prompt] of Object.entries(domainPrompts)) {
    const id = ASSISTANT_IDS.manager[key as keyof typeof ASSISTANT_IDS.manager];
    await updateAssistant(id, prompt, `${key} (Manager)`);
  }

  console.log('\n✅ All assistants updated.\n');
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
