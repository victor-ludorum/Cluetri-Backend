import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STORE_SKUS,
  getTierFromCountry,
  getCoachRatePaise,
  TIER_1_COUNTRIES,
  TIER_2A_COUNTRIES,
  TIER_2B_COUNTRIES,
  TIER_3_COUNTRIES,
} from '../src/config/storeCatalog.js';
import { iapWebhookHandler } from '../src/functions/iapWebhook.js';
import { liveWarRoomHandler } from '../src/functions/liveWarRoom.js';
import { db, enableInMemoryFirestore } from '../src/config/firebaseAdmin.js';
import { COLLECTIONS } from '../src/types/firestore.types.js';

enableInMemoryFirestore(true);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createMockReqRes(options: {
  method?: string;
  path?: string;
  url?: string;
  headers?: Record<string, string | string[]>;
  body?: any;
}) {
  let statusCode = 200;
  let responseData: any = null;
  const responseHeaders: Record<string, string> = {};

  const req: any = {
    method: options.method || 'POST',
    path: options.path || '/',
    url: options.url || options.path || '/',
    headers: options.headers || {},
    body: options.body || {},
  };

  const res: any = {
    set(key: string | Record<string, string>, val?: string) {
      if (typeof key === 'object') {
        for (const [k, v] of Object.entries(key)) {
          responseHeaders[k.toLowerCase()] = v;
        }
      } else if (val !== undefined) {
        responseHeaders[key.toLowerCase()] = val;
      }
      return res;
    },
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(data: any) {
      responseData = data;
      return res;
    },
    send(data: any) {
      responseData = data;
      return res;
    },
    end() {
      return res;
    },
  };

  return {
    req,
    res,
    getStatus: () => statusCode,
    getBody: () => responseData,
  };
}

// =============================================================================
// TEST 1: Country-to-Tier Mappings in storeCatalog.ts
// =============================================================================
test('1. storeCatalog - Country to Tier mapping verification', () => {
  // Tier 1 Top Tier
  for (const c of ['US', 'CA', 'GB', 'AU', 'NZ', 'DE', 'FR', 'NL', 'SE', 'NO', 'CH', 'IE', 'SG']) {
    assert.equal(getTierFromCountry(c), 'TIER_1', `${c} must be TIER_1`);
  }

  // Tier 2A Middle East / GCC
  for (const c of ['AE', 'SA', 'QA', 'KW', 'BH', 'OM']) {
    assert.equal(getTierFromCountry(c), 'TIER_2A', `${c} must be TIER_2A`);
  }

  // Tier 2B Mid Tier LATAM / E. Europe
  for (const c of ['BR', 'MX', 'CL', 'CO', 'PL', 'CZ', 'HU', 'RO', 'ZA', 'MY', 'TH']) {
    assert.equal(getTierFromCountry(c), 'TIER_2B', `${c} must be TIER_2B`);
  }

  // Tier 3 Value Tier South / SE Asia
  for (const c of ['IN', 'PK', 'PH', 'ID', 'VN', 'BD', 'LK', 'NP', 'NG', 'EG']) {
    assert.equal(getTierFromCountry(c), 'TIER_3', `${c} must be TIER_3`);
  }

  // Unknown / null fallback
  assert.equal(getTierFromCountry(null), 'TIER_3');
  assert.equal(getTierFromCountry(undefined), 'TIER_3');
  assert.equal(getTierFromCountry('UNKNOWN_COUNTRY'), 'TIER_3');
});

// =============================================================================
// TEST 2: 10 Store SKUs in storeCatalog.ts
// =============================================================================
test('2. storeCatalog - 10 Store SKUs and exact entitlements', () => {
  const skus = Object.keys(STORE_SKUS);
  assert.equal(skus.length, 10, 'Must have exactly 10 Store SKUs');

  // Single scan
  const scan = STORE_SKUS['cluetri_single_scan'];
  assert.equal(scan.entitlements.scanTokens, 1);
  assert.equal(scan.pricing.TIER_1.formatted, '$1.99');
  assert.equal(scan.pricing.TIER_2A.formatted, '5.99 AED');
  assert.equal(scan.pricing.TIER_2B.formatted, '$0.99');
  assert.equal(scan.pricing.TIER_3.formatted, '₹49');

  // Deck 01
  const deck1 = STORE_SKUS['deck_01_texting_icfu_a3'];
  assert.equal(deck1.entitlements.deckId, 'deck_01_texting_icfu_a3');
  assert.equal(deck1.pricing.TIER_1.formatted, '$6.99');
  assert.equal(deck1.pricing.TIER_2A.formatted, '17.99 AED');
  assert.equal(deck1.pricing.TIER_2B.formatted, '$3.49');
  assert.equal(deck1.pricing.TIER_3.formatted, '₹199');

  // Deck 02
  const deck2 = STORE_SKUS['deck_02_irl_oae_date_mastery'];
  assert.equal(deck2.entitlements.deckId, 'deck_02_irl_oae_date_mastery');
  assert.equal(deck2.pricing.TIER_1.formatted, '$6.99');
  assert.equal(deck2.pricing.TIER_2A.formatted, '17.99 AED');
  assert.equal(deck2.pricing.TIER_2B.formatted, '$3.49');
  assert.equal(deck2.pricing.TIER_3.formatted, '₹199');

  // Photo Roast
  const roast = STORE_SKUS['cluetri_photo_roast_async'];
  assert.equal(roast.entitlements.photoRoastTokens, 1);
  assert.equal(roast.pricing.TIER_1.formatted, '$14.99');
  assert.equal(roast.pricing.TIER_2A.formatted, '36.99 AED');
  assert.equal(roast.pricing.TIER_2B.formatted, '$6.99');
  assert.equal(roast.pricing.TIER_3.formatted, '₹199');

  // Wallet Starter (300s standard / 420s 1st top-up)
  const starter = STORE_SKUS['cluetri_wallet_starter'];
  assert.equal(starter.entitlements.standardSeconds, 300);
  assert.equal(starter.entitlements.firstTopUpSeconds, 420);
  assert.equal(starter.pricing.TIER_1.formatted, '$6.99');
  assert.equal(starter.pricing.TIER_2A.formatted, '17.99 AED');
  assert.equal(starter.pricing.TIER_2B.formatted, '$3.99');
  assert.equal(starter.pricing.TIER_3.formatted, '₹149');

  // Wallet Popular (720s standard / 900s 1st top-up)
  const popular = STORE_SKUS['cluetri_wallet_popular'];
  assert.equal(popular.entitlements.standardSeconds, 720);
  assert.equal(popular.entitlements.firstTopUpSeconds, 900);
  assert.equal(popular.pricing.TIER_1.formatted, '$14.99');
  assert.equal(popular.pricing.TIER_2A.formatted, '36.99 AED');
  assert.equal(popular.pricing.TIER_2B.formatted, '$7.99');
  assert.equal(popular.pricing.TIER_3.formatted, '₹299');

  // Wallet Pro (1800s standard / 2280s 1st top-up + 1 Photo Roast Token)
  const pro = STORE_SKUS['cluetri_wallet_pro'];
  assert.equal(pro.entitlements.standardSeconds, 1800);
  assert.equal(pro.entitlements.firstTopUpSeconds, 2280);
  assert.equal(pro.entitlements.photoRoastTokens, 1);
  assert.equal(pro.pricing.TIER_1.formatted, '$34.99');
  assert.equal(pro.pricing.TIER_2A.formatted, '89.99 AED');
  assert.equal(pro.pricing.TIER_2B.formatted, '$19.99');
  assert.equal(pro.pricing.TIER_3.formatted, '₹699');

  // Pro Monthly
  const monthly = STORE_SKUS['cluetri_pro_monthly'];
  assert.equal(monthly.entitlements.subscriptionDays, 30);
  assert.equal(monthly.pricing.TIER_1.formatted, '$12.99');
  assert.equal(monthly.pricing.TIER_2A.formatted, '32.99 AED');
  assert.equal(monthly.pricing.TIER_2B.formatted, '$5.99');
  assert.equal(monthly.pricing.TIER_3.formatted, '₹399');

  // Pro Quarterly
  const quarterly = STORE_SKUS['cluetri_pro_quarterly'];
  assert.equal(quarterly.entitlements.subscriptionDays, 90);
  assert.equal(quarterly.pricing.TIER_1.formatted, '$29.99');
  assert.equal(quarterly.pricing.TIER_2A.formatted, '74.99 AED');
  assert.equal(quarterly.pricing.TIER_2B.formatted, '$12.99');
  assert.equal(quarterly.pricing.TIER_3.formatted, '₹899');

  // Pro Yearly
  const yearly = STORE_SKUS['cluetri_pro_yearly'];
  assert.equal(yearly.entitlements.subscriptionDays, 365);
  assert.equal(yearly.pricing.TIER_1.formatted, '$59.99');
  assert.equal(yearly.pricing.TIER_2A.formatted, '149.99 AED');
  assert.equal(yearly.pricing.TIER_2B.formatted, '$24.99');
  assert.equal(yearly.pricing.TIER_3.formatted, '₹2,499');
});

// =============================================================================
// TEST 3: Pricing in seeds/cluetri_50_cards_seed.json
// =============================================================================
test('3. seeds/cluetri_50_cards_seed.json - Pricing on drill decks', () => {
  const seedPath = path.resolve(__dirname, '../seeds/cluetri_50_cards_seed.json');
  const raw = fs.readFileSync(seedPath, 'utf-8');
  const seed = JSON.parse(raw);

  const deck1 = seed.storeDecks.find((d: any) => d.id === 'deck_01_texting_icfu_a3');
  assert.ok(deck1, 'deck_01_texting_icfu_a3 must exist in storeDecks');
  assert.equal(deck1.pricing.tier_1_usd, 6.99);
  assert.equal(deck1.pricing.tier_2a_aed, 17.99);
  assert.equal(deck1.pricing.tier_2a_sar, 17.99);
  assert.equal(deck1.pricing.tier_2b_usd, 3.49);
  assert.equal(deck1.pricing.tier_3_inr, 199);
  assert.equal(deck1.pricing.tier_3_pkr, 650);

  const deck2 = seed.storeDecks.find((d: any) => d.id === 'deck_02_irl_oae_date_mastery');
  assert.ok(deck2, 'deck_02_irl_oae_date_mastery must exist in storeDecks');
  assert.equal(deck2.pricing.tier_1_usd, 6.99);
  assert.equal(deck2.pricing.tier_2a_aed, 17.99);
  assert.equal(deck2.pricing.tier_2a_sar, 17.99);
  assert.equal(deck2.pricing.tier_2b_usd, 3.49);
  assert.equal(deck2.pricing.tier_3_inr, 199);
  assert.equal(deck2.pricing.tier_3_pkr, 650);
});

// =============================================================================
// TEST 4: Coach Payout Rate Helper getCoachRatePaise
// =============================================================================
test('4. storeCatalog - Coach payout rates calculation', () => {
  // Tier 1 (US/UK/EU): 2250 paise (₹22.50/min — 1.5x Global Arbitrage Surge)
  assert.equal(getCoachRatePaise('TIER_1', 'TIER_2'), 2250);
  assert.equal(getCoachRatePaise('TIER_1', 'TIER_3'), 2250);

  // Tier 2A & 2B (GCC & LATAM): 1800 paise (₹18.00/min — 1.35x Regional Surge)
  assert.equal(getCoachRatePaise('TIER_2A', 'TIER_2'), 1800);
  assert.equal(getCoachRatePaise('TIER_2B', 'TIER_2'), 1800);
  assert.equal(getCoachRatePaise('TIER_2A', 'TIER_3'), 1800);
  assert.equal(getCoachRatePaise('TIER_2B', 'TIER_3'), 1800);

  // Tier 3 (Domestic South Asia):
  // Tier 2 Coach: 1300 paise (₹13.00/min)
  // Tier 3 Coach: 1800 paise (₹18.00/min)
  assert.equal(getCoachRatePaise('TIER_3', 'TIER_2'), 1300);
  assert.equal(getCoachRatePaise('TIER_3', 'TIER_3'), 1800);
});

// =============================================================================
// TEST 5: iapWebhook records paidSecondsRemaining & lastPurchaseTier
// =============================================================================
test('5. iapWebhook - Minute wallet balance & lastPurchaseTier recording', async () => {
  process.env.REVENUECAT_WEBHOOK_AUTH_HEADER = 'rc_secret_token_123';
  const headers = { authorization: 'Bearer rc_secret_token_123' };

  // Starter purchase from UAE (GCC -> TIER_2A)
  const mockStarterGCC = createMockReqRes({
    headers,
    body: {
      event: {
        id: 'e_starter_gcc',
        type: 'INITIAL_PURCHASE',
        product_id: 'cluetri_wallet_starter',
        app_user_id: 'u_user_dubai',
        country_code: 'AE',
        transaction_id: 'tx_gcc_1',
      },
    },
  });

  await iapWebhookHandler(mockStarterGCC.req, mockStarterGCC.res);
  assert.equal(mockStarterGCC.getStatus(), 200);

  const walletDubai = await db.collection(COLLECTIONS.WALLETS).doc('u_user_dubai').get();
  assert.equal(walletDubai.data()?.paidSecondsRemaining, 420); // 7 mins on 1st top-up
  assert.equal(walletDubai.data()?.lastPurchaseTier, 'TIER_2A');

  // Subsequent purchase adds 300s (5 mins standard)
  const mockStarterGCC2 = createMockReqRes({
    headers,
    body: {
      event: {
        id: 'e_starter_gcc_2',
        type: 'NON_RENEWING_PURCHASE',
        product_id: 'cluetri_wallet_starter',
        app_user_id: 'u_user_dubai',
        country_code: 'AE',
        transaction_id: 'tx_gcc_2',
      },
    },
  });

  await iapWebhookHandler(mockStarterGCC2.req, mockStarterGCC2.res);
  assert.equal(mockStarterGCC2.getStatus(), 200);

  const walletDubai2 = await db.collection(COLLECTIONS.WALLETS).doc('u_user_dubai').get();
  assert.equal(walletDubai2.data()?.paidSecondsRemaining, 720); // 420 + 300 = 720s
});

// =============================================================================
// TEST 6: liveWarRoom BILLING_HEARTBEAT - Minute-based deduction and 4-tier coach payouts
// =============================================================================
test('6. liveWarRoom - BILLING_HEARTBEAT minute deduction and 4-tier coach earnings', async () => {
  const coachTier2Id = 'coach_t2_live';
  const coachTier3Id = 'coach_t3_live';

  await db.collection(COLLECTIONS.COACHES).doc(coachTier2Id).set({
    id: coachTier2Id,
    tier: 'TIER_2',
    withdrawablePaise: 0,
    totalEarningsInr: 0,
  });

  await db.collection(COLLECTIONS.COACHES).doc(coachTier3Id).set({
    id: coachTier3Id,
    tier: 'TIER_3',
    withdrawablePaise: 0,
    totalEarningsInr: 0,
  });

  // CASE A: Free Trial Consumption (freeTrialSecondsLeft: 120s -> 60s, coach earns 0)
  const trialSessionId = 'sess_trial_heartbeat';
  await db.collection(COLLECTIONS.LIVE_SESSIONS).doc(trialSessionId).set({
    id: trialSessionId,
    status: 'ACTIVE',
    coachId: coachTier2Id,
    clientId: 'u_trial_heartbeat',
    durationSeconds: 0,
  });

  await db.collection(COLLECTIONS.WALLETS).doc('u_trial_heartbeat').set({
    id: 'u_trial_heartbeat',
    userId: 'u_trial_heartbeat',
    freeTrialSecondsLeft: 120,
    paidSecondsRemaining: 300,
    lastPurchaseTier: 'TIER_3',
  });

  const mockHb1 = createMockReqRes({
    body: {
      action: 'BILLING_HEARTBEAT',
      sessionId: trialSessionId,
    },
  });

  await liveWarRoomHandler(mockHb1.req, mockHb1.res);
  assert.equal(mockHb1.getStatus(), 200);
  assert.equal(mockHb1.getBody().freeTrialSecondsLeft, 60);
  assert.equal(mockHb1.getBody().coachEarnedPaise, 0); // 0 during free trial

  // CASE B: TIER_3 Client + Tier 2 Coach (Earns ₹13.00/min / 1300 paise)
  const t3SessionId = 'sess_t3_heartbeat';
  await db.collection(COLLECTIONS.LIVE_SESSIONS).doc(t3SessionId).set({
    id: t3SessionId,
    status: 'ACTIVE',
    coachId: coachTier2Id,
    clientId: 'u_t3_heartbeat',
    lastPurchaseTier: 'TIER_3',
    durationSeconds: 0,
  });

  await db.collection(COLLECTIONS.WALLETS).doc('u_t3_heartbeat').set({
    id: 'u_t3_heartbeat',
    userId: 'u_t3_heartbeat',
    freeTrialSecondsLeft: 0,
    paidSecondsRemaining: 300,
    lastPurchaseTier: 'TIER_3',
  });

  const mockHbT3 = createMockReqRes({
    body: {
      action: 'BILLING_HEARTBEAT',
      sessionId: t3SessionId,
    },
  });

  await liveWarRoomHandler(mockHbT3.req, mockHbT3.res);
  assert.equal(mockHbT3.getStatus(), 200);
  assert.equal(mockHbT3.getBody().paidSecondsRemaining, 240); // 300 - 60 = 240
  assert.equal(mockHbT3.getBody().coachEarnedPaise, 1300); // ₹13.00/min for Tier 2 coach

  const cT2Doc = await db.collection(COLLECTIONS.COACHES).doc(coachTier2Id).get();
  assert.equal(cT2Doc.data()?.withdrawablePaise, 1300);

  // CASE C: TIER_3 Client + Tier 3 Coach (Earns ₹18.00/min / 1800 paise)
  const t3SeniorSessionId = 'sess_t3_senior_heartbeat';
  await db.collection(COLLECTIONS.LIVE_SESSIONS).doc(t3SeniorSessionId).set({
    id: t3SeniorSessionId,
    status: 'ACTIVE',
    coachId: coachTier3Id,
    clientId: 'u_t3_senior_heartbeat',
    lastPurchaseTier: 'TIER_3',
    durationSeconds: 0,
  });

  await db.collection(COLLECTIONS.WALLETS).doc('u_t3_senior_heartbeat').set({
    id: 'u_t3_senior_heartbeat',
    userId: 'u_t3_senior_heartbeat',
    freeTrialSecondsLeft: 0,
    paidSecondsRemaining: 300,
    lastPurchaseTier: 'TIER_3',
  });

  const mockHbT3Senior = createMockReqRes({
    body: {
      action: 'BILLING_HEARTBEAT',
      sessionId: t3SeniorSessionId,
    },
  });

  await liveWarRoomHandler(mockHbT3Senior.req, mockHbT3Senior.res);
  assert.equal(mockHbT3Senior.getStatus(), 200);
  assert.equal(mockHbT3Senior.getBody().coachEarnedPaise, 1800); // ₹18.00/min for Tier 3 coach

  const cT3Doc = await db.collection(COLLECTIONS.COACHES).doc(coachTier3Id).get();
  assert.equal(cT3Doc.data()?.withdrawablePaise, 1800);

  // CASE D: TIER_2A (GCC) Client (Earns ₹18.00/min / 1800 paise — 1.35x Regional Surge)
  const t2aSessionId = 'sess_t2a_heartbeat';
  await db.collection(COLLECTIONS.LIVE_SESSIONS).doc(t2aSessionId).set({
    id: t2aSessionId,
    status: 'ACTIVE',
    coachId: coachTier2Id,
    clientId: 'u_t2a_heartbeat',
    lastPurchaseTier: 'TIER_2A',
    durationSeconds: 0,
  });

  await db.collection(COLLECTIONS.WALLETS).doc('u_t2a_heartbeat').set({
    id: 'u_t2a_heartbeat',
    userId: 'u_t2a_heartbeat',
    freeTrialSecondsLeft: 0,
    paidSecondsRemaining: 300,
    lastPurchaseTier: 'TIER_2A',
  });

  const mockHbT2a = createMockReqRes({
    body: {
      action: 'BILLING_HEARTBEAT',
      sessionId: t2aSessionId,
    },
  });

  await liveWarRoomHandler(mockHbT2a.req, mockHbT2a.res);
  assert.equal(mockHbT2a.getStatus(), 200);
  assert.equal(mockHbT2a.getBody().coachEarnedPaise, 1800); // 1.35x Regional Surge

  // CASE E: TIER_1 (US) Client (Earns ₹22.50/min / 2250 paise — 1.5x Global Arbitrage Surge)
  const t1SessionId = 'sess_t1_heartbeat';
  await db.collection(COLLECTIONS.LIVE_SESSIONS).doc(t1SessionId).set({
    id: t1SessionId,
    status: 'ACTIVE',
    coachId: coachTier2Id,
    clientId: 'u_t1_heartbeat',
    lastPurchaseTier: 'TIER_1',
    durationSeconds: 0,
  });

  await db.collection(COLLECTIONS.WALLETS).doc('u_t1_heartbeat').set({
    id: 'u_t1_heartbeat',
    userId: 'u_t1_heartbeat',
    freeTrialSecondsLeft: 0,
    paidSecondsRemaining: 300,
    lastPurchaseTier: 'TIER_1',
  });

  const mockHbT1 = createMockReqRes({
    body: {
      action: 'BILLING_HEARTBEAT',
      sessionId: t1SessionId,
    },
  });

  await liveWarRoomHandler(mockHbT1.req, mockHbT1.res);
  assert.equal(mockHbT1.getStatus(), 200);
  assert.equal(mockHbT1.getBody().coachEarnedPaise, 2250); // 1.5x Global Arbitrage Surge

  // CASE F: Low Balance Warning triggered when paid seconds < 60s
  const lowBalSessionId = 'sess_low_bal_heartbeat';
  await db.collection(COLLECTIONS.LIVE_SESSIONS).doc(lowBalSessionId).set({
    id: lowBalSessionId,
    status: 'ACTIVE',
    coachId: coachTier2Id,
    clientId: 'u_low_bal',
    lastPurchaseTier: 'TIER_3',
    durationSeconds: 0,
  });

  await db.collection(COLLECTIONS.WALLETS).doc('u_low_bal').set({
    id: 'u_low_bal',
    userId: 'u_low_bal',
    freeTrialSecondsLeft: 0,
    paidSecondsRemaining: 60, // exactly 1 minute left
    lastPurchaseTier: 'TIER_3',
  });

  const mockHbLow = createMockReqRes({
    body: {
      action: 'BILLING_HEARTBEAT',
      sessionId: lowBalSessionId,
    },
  });

  await liveWarRoomHandler(mockHbLow.req, mockHbLow.res);
  assert.equal(mockHbLow.getStatus(), 200);
  assert.equal(mockHbLow.getBody().paidSecondsRemaining, 0); // 60 - 60 = 0
  assert.equal(mockHbLow.getBody().warning, 'LOW_BALANCE_45S'); // Triggers warning
});
