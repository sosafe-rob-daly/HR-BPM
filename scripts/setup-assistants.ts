#!/usr/bin/env npx tsx
/**
 * Create OpenAI Assistants for HR-BPM (Dual Tier)
 *
 * Creates 10 assistants:
 * - 1 classifier (shared, no file search)
 * - 1 escalation (shared, no file search)
 * - 4 general domain assistants (with general vector store)
 * - 4 manager domain assistants (with manager vector store)
 *
 * Environment variables:
 *   OPENAI_API_KEY            — OpenAI API key
 *   VECTOR_STORE_ID_GENERAL   — vector store with unrestricted pages
 *   VECTOR_STORE_ID_MANAGER   — vector store with ALL pages
 *
 * Usage:
 *   export OPENAI_API_KEY="sk-..."
 *   export VECTOR_STORE_ID_GENERAL="vs_..."
 *   export VECTOR_STORE_ID_MANAGER="vs_..."
 *   npx tsx scripts/setup-assistants.ts
 */

import { CLASSIFIER_PROMPT } from '../src/prompts/classifier';
import { ESCALATION_PROMPT } from '../src/prompts/escalation';
import { PERFORMANCE_PROMPT } from '../src/prompts/performance';
import { CONVERSATION_PROMPT } from '../src/prompts/conversation';
import { POLICY_PROMPT } from '../src/prompts/policy';
import { SEPARATION_PROMPT } from '../src/prompts/separation';
import { CAREER_PROMPT } from '../src/prompts/career';
import { FEEDBACK_PROMPT } from '../src/prompts/feedback';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const VS_GENERAL = process.env.VECTOR_STORE_ID_GENERAL;
const VS_MANAGER = process.env.VECTOR_STORE_ID_MANAGER;

if (!OPENAI_API_KEY) { console.error('Missing OPENAI_API_KEY'); process.exit(1); }
if (!VS_GENERAL) { console.error('Missing VECTOR_STORE_ID_GENERAL'); process.exit(1); }
if (!VS_MANAGER) { console.error('Missing VECTOR_STORE_ID_MANAGER'); process.exit(1); }

const MODEL = 'gpt-4o';

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

const domainAgents = [
  { key: 'performance', name: 'Performance', instructions: PERFORMANCE_PROMPT },
  { key: 'conversation', name: 'Conversation', instructions: CONVERSATION_PROMPT },
  { key: 'policy', name: 'Policy', instructions: POLICY_PROMPT },
  { key: 'separation', name: 'Separation', instructions: SEPARATION_PROMPT },
  { key: 'career', name: 'Career', instructions: CAREER_PROMPT },
  { key: 'feedback', name: 'Feedback', instructions: FEEDBACK_PROMPT },
];

async function createAssistant(
  name: string,
  instructions: string,
  options: {
    tools?: unknown[];
    vectorStoreId?: string;
    responseFormat?: unknown;
  } = {},
): Promise<string> {
  const body: Record<string, unknown> = {
    model: MODEL,
    name,
    instructions,
    tools: options.tools ?? [],
    temperature: 0.2,
  };

  if (options.vectorStoreId) {
    body.tool_resources = {
      file_search: { vector_store_ids: [options.vectorStoreId] },
    };
  }

  if (options.responseFormat) {
    body.response_format = options.responseFormat;
  }

  const res = await fetch('https://api.openai.com/v1/assistants', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
      'OpenAI-Beta': 'assistants=v2',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to create ${name}: ${res.status} ${err}`);
  }

  const data = (await res.json()) as { id: string };
  return data.id;
}

async function main() {
  console.log('\n🔧 Creating HR-BPM Assistants (Dual Tier)\n');

  // Shared assistants
  console.log('  Creating shared assistants...');

  console.log('    Classifier...');
  const classifierId = await createAssistant('HR-BPM Classifier', CLASSIFIER_PROMPT, {
    responseFormat: classifierSchema,
  });
  console.log(`      ✅ ${classifierId}`);

  console.log('    Escalation...');
  const escalationId = await createAssistant('HR-BPM Escalation', ESCALATION_PROMPT);
  console.log(`      ✅ ${escalationId}`);

  // General tier
  console.log('\n  Creating GENERAL tier assistants...');
  const generalIds: Record<string, string> = {};
  for (const agent of domainAgents) {
    console.log(`    ${agent.name} (General)...`);
    const id = await createAssistant(`HR-BPM ${agent.name} (General)`, agent.instructions, {
      tools: [{ type: 'file_search' }],
      vectorStoreId: VS_GENERAL,
    });
    generalIds[agent.key] = id;
    console.log(`      ✅ ${id}`);
  }

  // Manager tier
  console.log('\n  Creating MANAGER tier assistants...');
  const managerIds: Record<string, string> = {};
  for (const agent of domainAgents) {
    console.log(`    ${agent.name} (Manager)...`);
    const id = await createAssistant(`HR-BPM ${agent.name} (Manager)`, agent.instructions, {
      tools: [{ type: 'file_search' }],
      vectorStoreId: VS_MANAGER,
    });
    managerIds[agent.key] = id;
    console.log(`      ✅ ${id}`);
  }

  // Output
  console.log('\n\n📋 Paste into src/assistants.ts:\n');
  console.log('export const ASSISTANT_IDS = {');
  console.log(`  classifier: '${classifierId}',`);
  console.log(`  escalation: '${escalationId}',`);
  console.log('  general: {');
  for (const [key, id] of Object.entries(generalIds)) {
    console.log(`    ${key}: '${id}',`);
  }
  console.log('  },');
  console.log('  manager: {');
  for (const [key, id] of Object.entries(managerIds)) {
    console.log(`    ${key}: '${id}',`);
  }
  console.log('  },');
  console.log('};\n');
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
