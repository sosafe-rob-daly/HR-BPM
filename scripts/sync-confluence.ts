#!/usr/bin/env npx tsx
/**
 * Confluence → OpenAI Vector Store Sync (Dual Store)
 *
 * Fetches all pages from the HRKB Confluence space, checks page
 * restrictions, and uploads to TWO vector stores:
 *   - General: pages with no read restrictions (safe for everyone)
 *   - Manager: ALL pages (general + restricted)
 *
 * Environment variables:
 *   CONFLUENCE_EMAIL          — Atlassian account email
 *   CONFLUENCE_TOKEN          — Atlassian API token (standard, not scoped)
 *   CONFLUENCE_BASE_URL       — e.g. https://sosafegmbh.atlassian.net
 *   OPENAI_API_KEY            — OpenAI API key
 *   VECTOR_STORE_ID_GENERAL   — (optional) existing general store ID
 *   VECTOR_STORE_ID_MANAGER   — (optional) existing manager store ID
 *   CONFLUENCE_SPACE          — (optional) space key, defaults to HRKB
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
const STORE_ID_GENERAL = process.env.VECTOR_STORE_ID_GENERAL ?? null;
const STORE_ID_MANAGER = process.env.VECTOR_STORE_ID_MANAGER ?? null;

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

type AccessLevel = 'general' | 'restricted';

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

async function fetchPageAccessLevel(pageId: string): Promise<AccessLevel> {
  try {
    const data = (await confluenceFetch(
      `/content/${pageId}/restriction`,
    )) as { results: { operation: string; restrictions: { group: { results: unknown[]; size: number } } }[] };

    for (const restriction of data.results) {
      if (restriction.operation === 'read') {
        const groupCount = restriction.restrictions?.group?.size ?? 0;
        if (groupCount > 0) return 'restricted';
      }
    }

    return 'general';
  } catch {
    // If restriction endpoint fails, default to restricted (safe)
    return 'restricted';
  }
}

/** Fetch all descendant page IDs of a given page via CQL search. */
async function fetchDescendantIds(pageId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let start = 0;
  const limit = 50;

  while (true) {
    const data = (await confluenceFetch(
      `/content/search?cql=ancestor=${pageId}%20and%20space=${SPACE_KEY}&limit=${limit}&start=${start}`,
    )) as { results: { id: string }[]; size: number };

    for (const page of data.results) {
      ids.add(page.id);
    }

    if (data.size < limit) break;
    start += limit;
  }

  return ids;
}

/**
 * Build a complete access map that accounts for inherited restrictions.
 * 1. Check each page for explicit restrictions
 * 2. For any restricted page, mark all its descendants as restricted too
 */
async function buildAccessMap(pages: ConfluencePage[]): Promise<Map<string, AccessLevel>> {
  const accessMap = new Map<string, AccessLevel>();
  const explicitlyRestricted: string[] = [];

  // Pass 1: check explicit restrictions
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const level = await fetchPageAccessLevel(page.id);
    accessMap.set(page.id, level);
    if (level === 'restricted') explicitlyRestricted.push(page.id);

    if ((i + 1) % 10 === 0 || i === pages.length - 1) {
      const general = [...accessMap.values()].filter((v) => v === 'general').length;
      const restricted = [...accessMap.values()].filter((v) => v === 'restricted').length;
      console.log(`  [${i + 1}/${pages.length}] general: ${general}, restricted: ${restricted}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  // Pass 2: for each explicitly restricted page, mark all descendants as restricted
  if (explicitlyRestricted.length > 0) {
    console.log(`\n  Checking inherited restrictions for ${explicitlyRestricted.length} restricted pages...`);
    let inherited = 0;
    for (const pageId of explicitlyRestricted) {
      const descendantIds = await fetchDescendantIds(pageId);
      for (const descId of descendantIds) {
        if (accessMap.get(descId) === 'general') {
          accessMap.set(descId, 'restricted');
          inherited++;
        }
      }
    }
    console.log(`  Marked ${inherited} additional pages as restricted (inherited).`);
  }

  return accessMap;
}

// ── HTML → Plain text ───────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    // Preserve links as markdown before stripping tags
    .replace(/<a[^>]+href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
    .replace(/<\/(p|div|h[1-6]|li|tr|br\s*\/?)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(td|th)>/gi, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
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
  accessLevel: AccessLevel;
}

async function prepareDocuments(
  pages: ConfluencePage[],
  accessMap: Map<string, AccessLevel>,
): Promise<SyncDocument[]> {
  const docs: SyncDocument[] = [];

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const accessLevel = accessMap.get(page.id) ?? 'restricted';
    console.log(`  [${i + 1}/${pages.length}] Fetching body: ${page.title} [${accessLevel}]`);

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
      `Access: ${accessLevel}`,
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
      accessLevel,
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

async function getOrCreateStore(existingId: string | null, name: string): Promise<string> {
  if (existingId) {
    console.log(`  Using existing store: ${existingId}`);
    return existingId;
  }

  const data = (await openAiFetch('/vector_stores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })) as { id: string };

  console.log(`  Created new store: ${data.id}`);
  return data.id;
}

async function clearVectorStore(storeId: string) {
  let hasMore = true;
  let cleared = 0;

  while (hasMore) {
    const data = (await openAiFetch(`/vector_stores/${storeId}/files?limit=100`)) as {
      data: { id: string }[];
    };

    if (data.data.length === 0) break;

    for (const file of data.data) {
      await openAiFetch(`/vector_stores/${storeId}/files/${file.id}`, { method: 'DELETE' });
      cleared++;
    }

    hasMore = data.data.length === 100;
  }

  if (cleared > 0) console.log(`  Cleared ${cleared} existing files.`);
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

async function uploadDocsToStore(storeId: string, docs: SyncDocument[], label: string) {
  console.log(`\n  Uploading ${docs.length} documents to ${label} store...`);
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    console.log(`   [${i + 1}/${docs.length}] ${doc.title} (${doc.lastUpdated}) [${doc.accessLevel}]`);

    const fileId = await uploadFile(doc.content, doc.filename);
    await addFileToStore(storeId, fileId);
  }
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🔄 HR-BPM Confluence Sync (Dual Store)');
  console.log('=======================================\n');

  // 1. Fetch pages
  console.log(`1. Fetching pages from Confluence space ${SPACE_KEY}...`);
  const pages = await fetchAllPages();
  console.log(`   Found ${pages.length} pages.\n`);

  // 2. Check page restrictions (explicit + inherited)
  console.log('2. Checking page restrictions...');
  const accessMap = await buildAccessMap(pages);

  const generalCount = [...accessMap.values()].filter((v) => v === 'general').length;
  const restrictedCount = [...accessMap.values()].filter((v) => v === 'restricted').length;
  console.log(`   Summary: ${generalCount} general, ${restrictedCount} restricted\n`);

  // 3. Prepare documents
  console.log('3. Fetching page bodies and preparing documents...');
  const allDocs = await prepareDocuments(pages, accessMap);
  const generalDocs = allDocs.filter((d) => d.accessLevel === 'general');
  console.log(`   Prepared ${allDocs.length} total (${generalDocs.length} general, ${allDocs.length - generalDocs.length} restricted)\n`);

  // 4. Set up vector stores
  const dateStr = new Date().toISOString().slice(0, 10);
  console.log('4. Setting up OpenAI vector stores...');
  const generalStoreId = await getOrCreateStore(
    STORE_ID_GENERAL,
    `HR-BPM General — ${dateStr}`,
  );
  const managerStoreId = await getOrCreateStore(
    STORE_ID_MANAGER,
    `HR-BPM Manager (All) — ${dateStr}`,
  );

  // 5. Clear existing files if updating
  if (STORE_ID_GENERAL) {
    console.log('\n5a. Clearing general store...');
    await clearVectorStore(generalStoreId);
  }
  if (STORE_ID_MANAGER) {
    console.log('5b. Clearing manager store...');
    await clearVectorStore(managerStoreId);
  }

  // 6. Upload documents
  console.log('\n6. Uploading documents...');
  await uploadDocsToStore(generalStoreId, generalDocs, 'GENERAL');
  await uploadDocsToStore(managerStoreId, allDocs, 'MANAGER');

  // 7. Summary
  console.log('\n\n✅ Sync complete!\n');
  console.log(`   General store: ${generalStoreId} (${generalDocs.length} docs)`);
  console.log(`   Manager store: ${managerStoreId} (${allDocs.length} docs)`);
  console.log(`   Space: ${SPACE_KEY}`);
  console.log(`\n   Save these for future syncs and assistant setup:`);
  console.log(`   export VECTOR_STORE_ID_GENERAL="${generalStoreId}"`);
  console.log(`   export VECTOR_STORE_ID_MANAGER="${managerStoreId}"\n`);

  console.log('   General documents:');
  for (const doc of generalDocs) {
    console.log(`     ${doc.lastUpdated}  ${doc.title}`);
  }
  console.log(`\n   Restricted documents (manager-only):`);
  for (const doc of allDocs.filter((d) => d.accessLevel === 'restricted')) {
    console.log(`     ${doc.lastUpdated}  ${doc.title}`);
  }
  console.log('');
}

main().catch((err) => {
  console.error('\n❌ Sync failed:', err.message);
  process.exit(1);
});
