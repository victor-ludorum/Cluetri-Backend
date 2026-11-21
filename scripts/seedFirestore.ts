import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db, hasGcpCredentials, enableInMemoryFirestore } from '../src/config/firebaseAdmin.js';
import { COLLECTIONS } from '../src/types/firestore.types.js';
import type { DeckDoc, CardDoc } from '../src/types/firestore.types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface SeedData {
  decks: Array<{
    id: string;
    title: string;
    subtitle: string;
    iconColor: string;
    isPro: boolean;
    cardCount: number;
    pricing?: Record<string, number>;
  }>;
  storeDecks?: Array<{
    id: string;
    title: string;
    subtitle: string;
    iconColor?: string;
    isPro?: boolean;
    pricing: Record<string, number>;
  }>;
  cards: Array<{
    id: string;
    deckId: string;
    deckTitle: string;
    title: string;
    archetype: string;
    icfuTag: string;
    badMove: string;
    goodMove: string;
    hinglish: string;
    bracketCustomizer: string;
    intervalDays: number;
    masteryLevel: number;
  }>;
}

/**
 * Encodes a JS value into the official Cloud Firestore v1 REST Value format.
 */
function toFirestoreRestValue(val: unknown): Record<string, unknown> {
  if (val === null || val === undefined) {
    return { nullValue: null };
  }
  if (val instanceof Date) {
    return { timestampValue: val.toISOString() };
  }
  if (typeof val === 'boolean') {
    return { booleanValue: val };
  }
  if (typeof val === 'number') {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (typeof val === 'string') {
    return { stringValue: val };
  }
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map((item) => toFirestoreRestValue(item)) } };
  }
  if (typeof val === 'object') {
    const fields: Record<string, Record<string, unknown>> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v !== undefined) {
        fields[k] = toFirestoreRestValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

/**
 * Commits a batch of upserts via the official Cloud Firestore v1 REST API
 * using an OAuth2 access token from `gcloud auth print-access-token`.
 */
async function commitBatchViaRest(
  projectId: string,
  accessToken: string,
  docs: Array<{ collection: string; id: string; data: Record<string, unknown> }>
): Promise<void> {
  const endpoint = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit`;
  const writes = docs.map(({ collection, id, data }) => {
    const fields: Record<string, Record<string, unknown>> = {};
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined) {
        fields[k] = toFirestoreRestValue(v);
      }
    }
    return {
      update: {
        name: `projects/${projectId}/databases/(default)/documents/${collection}/${id}`,
        fields,
      },
    };
  });

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'x-goog-user-project': projectId,
    },
    body: JSON.stringify({ writes }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Firestore REST commit failed (${resp.status}): ${errText}`);
  }
}

export async function seedFirestore(): Promise<void> {
  console.log('--- [Cluetri Firestore Seeder] Starting Idempotent Upsert ---');

  // Check if GCP credentials, explicit gcloud OAuth token, or emulator are available
  const gcloudToken = process.env.GCLOUD_ACCESS_TOKEN?.trim();
  const useRestMode = Boolean(gcloudToken) && !hasGcpCredentials() && process.env.NODE_ENV !== 'test';
  const credentialsAvailable = hasGcpCredentials() || Boolean(gcloudToken);
  const isTestEnv = process.env.NODE_ENV === 'test';
  const projectId = process.env.GCP_PROJECT || process.env.FIREBASE_PROJECT_ID || 'cluetri';

  if (!credentialsAvailable && !isTestEnv) {
    console.log('[Cluetri Firestore Seeder] ℹ No active Google Cloud project credentials or emulator detected.');
    console.log('[Cluetri Firestore Seeder] ℹ Skipping Cloud Firestore writes. No cloud database was created or modified.');
    console.log('[Cluetri Firestore Seeder] Once you create your new GCP project, configure credentials:');
    console.log('   export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"');
    console.log('   export GCP_PROJECT="cluetri"');
    console.log('   # or pass gcloud token: GCLOUD_ACCESS_TOKEN=$(gcloud auth print-access-token) npm run seed');
    console.log('--- [Cluetri Firestore Seeder] Ready for new GCP Project ---');
    return;
  }

  // If in test env, use in-memory store
  if (isTestEnv && !credentialsAvailable) {
    enableInMemoryFirestore(true);
  }

  // Resolve seed JSON from project seeds directory
  const candidates = [
    path.resolve(__dirname, '../seeds/cluetri_50_cards_seed.json'),
    path.resolve(process.cwd(), 'seeds/cluetri_50_cards_seed.json'),
  ];

  const seedFilePath = candidates.find((p) => fs.existsSync(p));
  if (!seedFilePath) {
    throw new Error(`Seed payload not found in candidates: ${candidates.join(', ')}`);
  }

  console.log(`Reading seed payload from: ${seedFilePath}`);
  const rawData = fs.readFileSync(seedFilePath, 'utf-8');
  const payload = JSON.parse(rawData) as SeedData;

  const decks = payload.decks || [];
  const storeDecks = payload.storeDecks || [];
  const cards = payload.cards || [];

  console.log(`Discovered ${decks.length} Decks, ${storeDecks.length} Store Decks, and ${cards.length} Cards to upsert.`);

  // 1. Build Decks to upsert into decks/{deck_id}
  const allDecksToUpsert = [
    ...decks.map((d) => ({ ...d, isStoreDeck: false })),
    ...storeDecks.map((sd) => ({
      id: sd.id,
      title: sd.title,
      subtitle: sd.subtitle,
      iconColor: sd.iconColor || '#3B82F6',
      isPro: sd.isPro ?? true,
      cardCount: 25,
      pricing: sd.pricing,
      isStoreDeck: true,
    })),
  ];

  const deckRecords: Array<{ id: string; record: DeckDoc }> = allDecksToUpsert.map((deck) => {
    const deckId = deck.id;
    const isFreePreview = !deck.isPro;
    return {
      id: deckId,
      record: {
        id: deckId,
        deck_id: deckId,
        title: deck.title,
        subtitle: deck.subtitle,
        iconColor: deck.iconColor,
        isPro: deck.isPro ?? false,
        is_free_preview: isFreePreview,
        cardCount: deck.cardCount || 10,
        pricing: deck.pricing as DeckDoc['pricing'],
        updatedAt: new Date(),
      },
    };
  });

  if (deckRecords.length > 0) {
    if (useRestMode && gcloudToken) {
      await commitBatchViaRest(
        projectId,
        gcloudToken,
        deckRecords.map(({ id, record }) => ({
          collection: COLLECTIONS.DECKS,
          id,
          data: record as unknown as Record<string, unknown>,
        }))
      );
    } else {
      const deckBatch = db.batch();
      for (const { id, record } of deckRecords) {
        const docRef = db.collection(COLLECTIONS.DECKS).doc(id);
        deckBatch.set(docRef, record, { merge: true });
      }
      await deckBatch.commit();
    }
    console.log(`✓ Upserted ${deckRecords.length} Decks into '${COLLECTIONS.DECKS}/{deck_id}'.`);
  }

  // 2. Build & batch upsert Cards into cards/{card_id} in chunks of 450
  const cardRecords: Array<{ id: string; record: CardDoc }> = cards.map((card, globalIndex) => {
    const cardId = card.id;
    const deckId = card.deckId;

    let icfuStage = card.icfuTag;
    if (card.icfuTag === 'CHALLENGE') {
      icfuStage = globalIndex % 2 === 0 ? 'CHALLENGE_TYPE_1' : 'CHALLENGE_TYPE_2';
    } else if (card.icfuTag === 'STALL') {
      icfuStage = 'UNRESPONSIVE';
    }

    const isFreePreview = deckId === 'anti-interview' || deckId === 'mixed-signals';

    return {
      id: cardId,
      record: {
        id: cardId,
        card_id: cardId,
        deckId,
        deck_id: deckId,
        deckTitle: card.deckTitle,
        title: card.title,
        archetype: card.archetype,
        icfuTag: card.icfuTag,
        icfu_stage: icfuStage,
        is_free_preview: isFreePreview,
        isPro: !isFreePreview,
        badMove: card.badMove,
        goodMove: card.goodMove,
        hinglish: card.hinglish,
        bracketCustomizer: card.bracketCustomizer,
        intervalDays: card.intervalDays,
        masteryLevel: card.masteryLevel,
        updatedAt: new Date(),
      },
    };
  });

  if (cardRecords.length > 0) {
    const CHUNK_SIZE = 450;
    for (let i = 0; i < cardRecords.length; i += CHUNK_SIZE) {
      const chunk = cardRecords.slice(i, i + CHUNK_SIZE);
      if (useRestMode && gcloudToken) {
        await commitBatchViaRest(
          projectId,
          gcloudToken,
          chunk.map(({ id, record }) => ({
            collection: COLLECTIONS.CARDS,
            id,
            data: record as unknown as Record<string, unknown>,
          }))
        );
      } else {
        const cardBatch = db.batch();
        for (const { id, record } of chunk) {
          const docRef = db.collection(COLLECTIONS.CARDS).doc(id);
          cardBatch.set(docRef, record, { merge: true });
        }
        await cardBatch.commit();
      }
      console.log(`✓ Committed cards chunk ${i + 1} - ${i + chunk.length} into '${COLLECTIONS.CARDS}/{card_id}'.`);
    }
    console.log(`✓ Successfully seeded all ${cardRecords.length} Cards.`);
  }

  console.log('--- [Cluetri Firestore Seeder] Completed Successfully ---');
}

// Direct CLI execution support
if (process.argv[1] && process.argv[1].includes('seedFirestore')) {
  seedFirestore()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Firestore seeding failed:', err);
      process.exit(1);
    });
}
