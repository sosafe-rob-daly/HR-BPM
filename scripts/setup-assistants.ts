#!/usr/bin/env npx tsx
/**
 * Create OpenAI Assistants for HR-BPM
 *
 * Creates a classifier assistant and five agent assistants, each with
 * the Confluence vector store attached for file search.
 *
 * Environment variables:
 *   OPENAI_API_KEY   — OpenAI API key
 *   VECTOR_STORE_ID  — vector store ID from sync-confluence.ts
 *
 * Usage:
 *   export OPENAI_API_KEY="sk-..."
 *   export VECTOR_STORE_ID="vs_..."
 *   npx tsx scripts/setup-assistants.ts
 *
 * Outputs assistant IDs to paste into src/assistants.ts
 */

import { CLASSIFIER_PROMPT } from '../src/prompts/classifier';
import { ESCALATION_PROMPT } from '../src/prompts/escalation';
import { PERFORMANCE_PROMPT } from '../src/prompts/performance';
import { CONVERSATION_PROMPT } from '../src/prompts/conversation';
import { POLICY_PROMPT } from '../src/prompts/policy';
import { SEPARATION_PROMPT } from '../src/prompts/separation';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const VECTOR_STORE_ID = process.env.VECTOR_STORE_ID;

if (!OPENAI_API_KEY) { console.error('Missing OPENAI_API_KEY'); process.exit(1); }
if (!VECTOR_STORE_ID) { console.error('Missing VECTOR_STORE_ID'); process.exit(1); }

const MODEL = 'gpt-4o';

interface AssistantDef {
  key: string;
  name: string;
  instructions: string;
  tools: unknown[];
  fileSearch: boolean;
  responseFormat?: unknown;
}

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

const assistants: AssistantDef[] = [
  {
    key: 'classifier',
    name: 'HR-BPM Classifier',
    instructions: CLASSIFIER_PROMPT,
    tools: [],
    fileSearch: false,
    responseFormat: classifierSchema,
  },
  {
    key: 'escalation',
    name: 'HR-BPM Escalation',
    instructions: ESCALATION_PROMPT,
    tools: [],
    fileSearch: false, // escalation doesn't need Confluence
  },
  {
    key: 'performance',
    name: 'HR-BPM Performance',
    instructions: PERFORMANCE_PROMPT,
    tools: [{ type: 'file_search' }],
    fileSearch: true,
  },
  {
    key: 'conversation',
    name: 'HR-BPM Conversation',
    instructions: CONVERSATION_PROMPT,
    tools: [{ type: 'file_search' }],
    fileSearch: true,
  },
  {
    key: 'policy',
    name: 'HR-BPM Policy',
    instructions: POLICY_PROMPT,
    tools: [{ type: 'file_search' }],
    fileSearch: true,
  },
  {
    key: 'separation',
    name: 'HR-BPM Separation',
    instructions: SEPARATION_PROMPT,
    tools: [{ type: 'file_search' }],
    fileSearch: true,
  },
];

async function createAssistant(def: AssistantDef): Promise<string> {
  const body: Record<string, unknown> = {
    model: MODEL,
    name: def.name,
    instructions: def.instructions,
    tools: def.tools,
  };

  if (def.fileSearch) {
    body.tool_resources = {
      file_search: { vector_store_ids: [VECTOR_STORE_ID] },
    };
  }

  if (def.responseFormat) {
    body.response_format = def.responseFormat;
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
    throw new Error(`Failed to create ${def.name}: ${res.status} ${err}`);
  }

  const data = (await res.json()) as { id: string };
  return data.id;
}

async function main() {
  console.log('\n🔧 Creating HR-BPM Assistants\n');

  const ids: Record<string, string> = {};

  for (const def of assistants) {
    console.log(`  Creating ${def.name}...`);
    const id = await createAssistant(def);
    ids[def.key] = id;
    console.log(`    ✅ ${id}`);
  }

  console.log('\n📋 Assistant IDs — paste into src/assistants.ts:\n');
  console.log('export const ASSISTANT_IDS = {');
  for (const [key, id] of Object.entries(ids)) {
    console.log(`  ${key}: '${id}',`);
  }
  console.log('};\n');
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
