#!/usr/bin/env npx tsx
/**
 * Confluence → OpenAI Vector Store Sync
 *
 * Fetches all pages from the HRKB Confluence space, strips HTML,
 * and uploads them as documents to an OpenAI vector store.
 *
 * Environment variables:
 *   CONFLUENCE_EMAIL    — Atlassian account email
 *   CONFLUENCE_TOKEN    — Atlassian API token (standard, not scoped)
 *   CONFLUENCE_BASE_URL — e.g. https://sosafegmbh.atlassian.net
 *   OPENAI_API_KEY      — OpenAI API key
 *   VECTOR_STORE_ID     — (optional) existing vector store ID to update; creates new if omitted
 *   CONFLUENCE_SPACE    — (optional) space key, defaults to HRKB
 *
 * Usage:
 *   export CONFLUENCE_EMAIL="rob.daly@sosafe.de"
 *   export CONFLUENCE_TOKEN="..."
 *   export CONFLUENCE_BASE_URL="https://sosafegmbh.atlassian.net"
 *   export OPENAI_API_KEY="sk-..."
 *   npx tsx scripts/sync-confluence.ts
 */

// ── Config ──────────────────────────────────────────────────────────

const CONFLUENCE_EMAIL = env('CONFLUENCE_EMAIL');
const CONFLUENCE_TOKEN = env('CONFLUENCE_TOKEN');
const CONFLUENCE_BASE_URL = env('CONFLUENCE_BASE_URL').replace(/\/+$/, '');
const OPENAI_API_KEY = env('OPENAI_API_KEY');
const SPACE_KEY = process.env.CONFLUENCE_SPACE ?? 'HRKB';
const VECTOR_STORE_ID = process.env.VECTOR_STORE_ID ?? null;

function env(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return val;
}

// ── Confluence API ──────────────────────────────────────────────────

interface ConfluencePage {
  id: string;
  title: string;
  version: { when: string; number: number };
  body?: { storage?: { value: string } };
  _links: { webui: string };
}

const confluenceAuth = Buffer.from(`${CONFLUENCE_EMAIL}:${CONFLUENCE_TOKEN}`).toString('base64');

async function confluenceFetch(path: string): Promise<unknown> {
  const url = `${CONFLUENCE_BASE_URL}/wiki/rest/api${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${confluenceAuth}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Confluence API ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function fetchAllPages(): Promise<ConfluencePage[]> {
  const pages: ConfluencePage[] = [];
  let start = 0;
  const limit = 50;

  while (true) {
    const data = (await confluenceFetch(
      `/space/${SPACE_KEY}/content/page?limit=${limit}&start=${start}&expand=version`,
    )) as { results: ConfluencePage[]; size: number };

    pages.push(...data.results);
    console.log(`  Fetched ${pages.length} page headers...`);

    if (data.size < limit) break;
    start += limit;
  }

  return pages;
}

async function fetchPageBody(pageId: string): Promise<string> {
  const data = (await confluenceFetch(
    `/content/${pageId}?expand=body.storage`,
  )) as ConfluencePage;

  return data.body?.storage?.value ?? '';
}

// ── HTML → Plain text ───────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    // Replace common block elements with newlines
    .replace(/<\/(p|div|h[1-6]|li|tr|br\s*\/?)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    // Replace table cells with tabs
    .replace(/<\/(td|th)>/gi, '\t')
    // Strip remaining tags
    .replace(/<[^>]+>/g, '')
    // Decode common HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Clean up whitespace
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n\n')
    .trim();
}

// ── Document preparation ────────────────────────────────────────────

interface SyncDocument {
  filename: string;
  content: string;
  pageId: string;
  title: string;
  lastUpdated: string;
  url: string;
}

async function prepareDocuments(pages: ConfluencePage[]): Promise<SyncDocument[]> {
  const docs: SyncDocument[] = [];

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    console.log(`  [${i + 1}/${pages.length}] Fetching body: ${page.title}`);

    const bodyHtml = await fetchPageBody(page.id);
    const bodyText = stripHtml(bodyHtml);

    if (bodyText.length < 50) {
      console.log(`    ⏭ Skipped (too short: ${bodyText.length} chars)`);
      continue;
    }

    const lastUpdated = page.version.when.slice(0, 10);
    const url = `${CONFLUENCE_BASE_URL}/wiki${page._links.webui}`;

    const header = [
      `Title: ${page.title}`,
      `Source: Confluence HRKB Space`,
      `URL: ${url}`,
      `Last updated: ${lastUpdated}`,
      `Page ID: ${page.id}`,
      '',
      '---',
      '',
    ].join('\n');

    const sanitizedTitle = page.title
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .toLowerCase()
      .slice(0, 60);

    docs.push({
      filename: `${sanitizedTitle}-${page.id}.txt`,
      content: header + bodyText,
      pageId: page.id,
      title: page.title,
      lastUpdated,
      url,
    });
  }

  return docs;
}

// ── OpenAI Vector Store ─────────────────────────────────────────────

async function openAiFetch(path: string, options: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`https://api.openai.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'OpenAI-Beta': 'assistants=v2',
      ...((options.headers as Record<string, string>) ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`OpenAI API ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function getOrCreateVectorStore(): Promise<string> {
  if (VECTOR_STORE_ID) {
    console.log(`  Using existing vector store: ${VECTOR_STORE_ID}`);
    return VECTOR_STORE_ID;
  }

  const data = (await openAiFetch('/vector_stores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `HR-BPM Confluence HRKB — ${new Date().toISOString().slice(0, 10)}`,
    }),
  })) as { id: string };

  console.log(`  Created new vector store: ${data.id}`);
  return data.id;
}

async function clearVectorStore(storeId: string) {
  // List existing files and delete them
  const data = (await openAiFetch(`/vector_stores/${storeId}/files?limit=100`)) as {
    data: { id: string }[];
  };

  if (data.data.length === 0) return;

  console.log(`  Clearing ${data.data.length} existing files...`);
  for (const file of data.data) {
    await openAiFetch(`/vector_stores/${storeId}/files/${file.id}`, { method: 'DELETE' });
  }
}

async function uploadFile(content: string, filename: string): Promise<string> {
  const blob = new Blob([content], { type: 'text/plain' });
  const form = new FormData();
  form.append('purpose', 'assistants');
  form.append('file', blob, filename);

  const res = await fetch('https://api.openai.com/v1/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });

  if (!res.ok) {
    throw new Error(`File upload failed ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as { id: string };
  return data.id;
}

async function addFileToStore(storeId: string, fileId: string) {
  await openAiFetch(`/vector_stores/${storeId}/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: fileId }),
  });
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🔄 HR-BPM Confluence Sync');
  console.log('========================\n');

  // 1. Fetch pages from Confluence
  console.log(`1. Fetching pages from Confluence space ${SPACE_KEY}...`);
  const pages = await fetchAllPages();
  console.log(`   Found ${pages.length} pages.\n`);

  // 2. Prepare documents
  console.log('2. Fetching page bodies and preparing documents...');
  const docs = await prepareDocuments(pages);
  console.log(`   Prepared ${docs.length} documents (${pages.length - docs.length} skipped).\n`);

  // 3. Get or create vector store
  console.log('3. Setting up OpenAI vector store...');
  const storeId = await getOrCreateVectorStore();

  // 4. Clear existing files if updating
  if (VECTOR_STORE_ID) {
    console.log('4. Clearing existing files in vector store...');
    await clearVectorStore(storeId);
  } else {
    console.log('4. New store, no files to clear.');
  }

  // 5. Upload documents
  console.log(`\n5. Uploading ${docs.length} documents to vector store...`);
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    console.log(`   [${i + 1}/${docs.length}] ${doc.title} (${doc.lastUpdated})`);

    const fileId = await uploadFile(doc.content, doc.filename);
    await addFileToStore(storeId, fileId);
  }

  // 6. Summary
  console.log('\n✅ Sync complete!\n');
  console.log(`   Vector store ID: ${storeId}`);
  console.log(`   Documents synced: ${docs.length}`);
  console.log(`   Space: ${SPACE_KEY}`);
  console.log(`\n   Save this vector store ID for future syncs:`);
  console.log(`   export VECTOR_STORE_ID="${storeId}"\n`);

  // Print manifest
  console.log('   Documents:');
  for (const doc of docs) {
    console.log(`     ${doc.lastUpdated}  ${doc.title}`);
  }
  console.log('');
}

main().catch((err) => {
  console.error('\n❌ Sync failed:', err.message);
  process.exit(1);
});
