import test from 'node:test';
import assert from 'node:assert/strict';
import { iapWebhookHandler } from '../src/functions/iapWebhook.js';
import { coachPayoutsHandler, markPayoutSettledHandler } from '../src/functions/coachPayouts.js';
import { liveWarRoomHandler } from '../src/functions/liveWarRoom.js';
import { cluetriApiHandler, withCors } from '../src/index.js';
import { db, enableInMemoryFirestore } from '../src/config/firebaseAdmin.js';
import { COLLECTIONS } from '../src/types/firestore.types.js';

enableInMemoryFirestore(true);

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
    setHeader(key: string, val: string) {
      responseHeaders[key.toLowerCase()] = val;
      return res;
    },
    getHeader(key: string) {
      return responseHeaders[key.toLowerCase()];
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

test('IAP Webhook - 1. Auth Header Verification', async () => {
  process.env.REVENUECAT_WEBHOOK_AUTH_HEADER = 'rc_secret_token_123';

  // Request without auth header should fail with 401
  const mock1 = createMockReqRes({
    headers: {},
    body: {
      event: {
        id: 'e_01',
        type: 'INITIAL_PURCHASE',
        product_id: 'cluetri_wallet_starter',
        app_user_id: 'u_auth_fail',
      },
    },
  });
  await iapWebhookHandler(mock1.req, mock1.res);
  assert.equal(mock1.getStatus(), 401);
  assert.equal(mock1.getBody().error, 'UNAUTHORIZED_WEBHOOK');

  // Request with correct Bearer header should succeed
  const mock2 = createMockReqRes({
    headers: {
      authorization: 'Bearer rc_secret_token_123',
    },
    body: {
      event: {
        id: 'e_auth_success',
        type: 'INITIAL_PURCHASE',
        product_id: 'cluetri_wallet_starter',
        app_user_id: 'u_auth_pass',
        transaction_id: 'tx_auth_pass',
      },
    },
  });
  await iapWebhookHandler(mock2.req, mock2.res);
  assert.equal(mock2.getStatus(), 200);
});

test('IAP Webhook - 2. Consumable Wallet Top-Ups & First Top-Up Bonus', async () => {
  process.env.REVENUECAT_WEBHOOK_AUTH_HEADER = 'rc_secret_token_123';
  const headers = { authorization: 'Bearer rc_secret_token_123' };

  // Starter: 1st top-up gives 14,000 units (equals 7 mins)
  const mockStarter1 = createMockReqRes({
    headers,
    body: {
      event: {
        id: 'e_starter_1',
        type: 'INITIAL_PURCHASE',
        product_id: 'cluetri_wallet_starter',
        app_user_id: 'u_wallet_starter',
        transaction_id: 'tx_starter_1',
      },
    },
  });
  await iapWebhookHandler(mockStarter1.req, mockStarter1.res);
  assert.equal(mockStarter1.getStatus(), 200);
  assert.equal(mockStarter1.getBody().result.creditedUnits, 14000);
  assert.equal(mockStarter1.getBody().result.bonusApplied, true);

  // Verify wallet balance
  const walletStarter = await db.collection(COLLECTIONS.WALLETS).doc('u_wallet_starter').get();
  assert.equal(walletStarter.data()?.balancePaise, 14000);
  assert.equal(walletStarter.data()?.firstTopUpBonusUsed, true);

  // Subsequent top-up: gives base 10,000 units (equals 5 mins)
  const mockStarter2 = createMockReqRes({
    headers,
    body: {
      event: {
        id: 'e_starter_2',
        type: 'NON_RENEWING_PURCHASE',
        product_id: 'cluetri_wallet_starter',
        app_user_id: 'u_wallet_starter',
        transaction_id: 'tx_starter_2',
      },
    },
  });
  await iapWebhookHandler(mockStarter2.req, mockStarter2.res);
  assert.equal(mockStarter2.getStatus(), 200);
  assert.equal(mockStarter2.getBody().result.creditedUnits, 10000);
  assert.equal(mockStarter2.getBody().result.bonusApplied, false);

  const walletStarter2 = await db.collection(COLLECTIONS.WALLETS).doc('u_wallet_starter').get();
  assert.equal(walletStarter2.data()?.balancePaise, 24000);

  // Popular: 1st top-up gives 28,000 units (equals 14 mins)
  const mockPopular = createMockReqRes({
    headers,
    body: {
      event: {
        id: 'e_popular_1',
        type: 'INITIAL_PURCHASE',
        product_id: 'cluetri_wallet_popular',
        app_user_id: 'u_wallet_pop',
        transaction_id: 'tx_pop_1',
      },
    },
  });
  await iapWebhookHandler(mockPopular.req, mockPopular.res);
  assert.equal(mockPopular.getBody().result.creditedUnits, 28000);

  // Pro: 1st top-up gives 70,000 units + 1 free photo audit token
  const mockPro = createMockReqRes({
    headers,
    body: {
      event: {
        id: 'e_pro_1',
        type: 'INITIAL_PURCHASE',
        product_id: 'cluetri_wallet_pro',
        app_user_id: 'u_wallet_pro',
        transaction_id: 'tx_pro_1',
      },
    },
  });
  await iapWebhookHandler(mockPro.req, mockPro.res);
  assert.equal(mockPro.getBody().result.creditedUnits, 70000);

  const walletPro = await db.collection(COLLECTIONS.WALLETS).doc('u_wallet_pro').get();
  assert.equal(walletPro.data()?.photoAuditTokens, 1);
});

test('IAP Webhook - 3. Single Scan & Async Photo Roast Tokens', async () => {
  const headers = { authorization: 'Bearer rc_secret_token_123' };

  // cluetri_single_scan: credits +1 single-scan token to wallets/{userId}.scanTokens
  const mockScan = createMockReqRes({
    headers,
    body: {
      event: {
        id: 'e_scan_1',
        type: 'NON_RENEWING_PURCHASE',
        product_id: 'cluetri_single_scan',
        app_user_id: 'u_scan_user',
        transaction_id: 'tx_scan_1',
      },
    },
  });
  await iapWebhookHandler(mockScan.req, mockScan.res);
  assert.equal(mockScan.getStatus(), 200);

  const walletScan = await db.collection(COLLECTIONS.WALLETS).doc('u_scan_user').get();
  assert.equal(walletScan.data()?.scanTokens, 1);

  // cluetri_photo_roast_async: creates paid slot in photo_audits and credits +₹65 (6500 paise) to coach
  await db.collection(COLLECTIONS.COACHES).doc('coach_roaster').set({
    id: 'coach_roaster',
    withdrawablePaise: 5000,
  });

  const mockRoast = createMockReqRes({
    headers,
    body: {
      event: {
        id: 'e_roast_1',
        type: 'NON_RENEWING_PURCHASE',
        product_id: 'cluetri_photo_roast_async',
        app_user_id: 'u_roast_user',
        transaction_id: 'tx_roast_1',
        subscriber_attributes: {
          $recommendedByCoachId: { value: 'coach_roaster' },
        },
      },
    },
  });
  await iapWebhookHandler(mockRoast.req, mockRoast.res);
  assert.equal(mockRoast.getStatus(), 200);

  const coachRoast = await db.collection(COLLECTIONS.COACHES).doc('coach_roaster').get();
  assert.equal(coachRoast.data()?.withdrawablePaise, 11500); // 5000 + 6500
});

test('IAP Webhook - 4. Non-Consumable Decks & Coach Affiliate Bonus', async () => {
  const headers = { authorization: 'Bearer rc_secret_token_123' };

  await db.collection(COLLECTIONS.COACHES).doc('coach_affiliate').set({
    id: 'coach_affiliate',
    withdrawablePaise: 10000,
  });

  const mockDeck = createMockReqRes({
    headers,
    body: {
      event: {
        id: 'e_deck_01',
        type: 'NON_RENEWING_PURCHASE',
        product_id: 'deck_01_texting_icfu_a3',
        app_user_id: 'u_deck_buyer',
        transaction_id: 'tx_deck_01',
        subscriber_attributes: {
          $recommendedByCoachId: { value: 'coach_affiliate' },
        },
      },
    },
  });
  await iapWebhookHandler(mockDeck.req, mockDeck.res);
  assert.equal(mockDeck.getStatus(), 200);

  // Verify unlockedDecks on user
  const userDoc = await db.collection(COLLECTIONS.USERS).doc('u_deck_buyer').get();
  assert.ok(userDoc.data()?.unlockedDecks.includes('deck_01_texting_icfu_a3'));

  // Verify +₹30 (3000 paise) Affiliate Bonus awarded to coach
  const coachDoc = await db.collection(COLLECTIONS.COACHES).doc('coach_affiliate').get();
  assert.equal(coachDoc.data()?.withdrawablePaise, 13000); // 10000 + 3000
});

test('IAP Webhook - 5. Trial-to-Paid Conversion Bounty & Global Surge Tagging', async () => {
  const headers = { authorization: 'Bearer rc_secret_token_123' };

  await db.collection(COLLECTIONS.COACHES).doc('coach_bounty').set({
    id: 'coach_bounty',
    withdrawablePaise: 20000,
  });

  await db.collection(COLLECTIONS.LIVE_SESSIONS).doc('sess_trial_100').set({
    id: 'sess_trial_100',
    coachId: 'coach_bounty',
    trialBountyAwarded: false,
  });

  const mockTopup = createMockReqRes({
    headers,
    body: {
      event: {
        id: 'e_bounty_topup',
        type: 'INITIAL_PURCHASE',
        product_id: 'cluetri_wallet_starter',
        app_user_id: 'u_surge_buyer',
        transaction_id: 'tx_bounty_surge',
        country_code: 'US', // In Tier 1 Global Surge list
        subscriber_attributes: {
          $activeSessionId: { value: 'sess_trial_100' },
        },
      },
    },
  });
  await iapWebhookHandler(mockTopup.req, mockTopup.res);
  assert.equal(mockTopup.getStatus(), 200);

  // Coach awarded +₹35 (3500 paise)
  const coachDoc = await db.collection(COLLECTIONS.COACHES).doc('coach_bounty').get();
  assert.equal(coachDoc.data()?.withdrawablePaise, 23500); // 20000 + 3500

  // Session marked as awarded
  const sessionDoc = await db.collection(COLLECTIONS.LIVE_SESSIONS).doc('sess_trial_100').get();
  assert.equal(sessionDoc.data()?.trialBountyAwarded, true);

  // Buyer wallet tagged with isGlobalSurgeEligible = true
  const buyerWallet = await db.collection(COLLECTIONS.WALLETS).doc('u_surge_buyer').get();
  assert.equal(buyerWallet.data()?.isGlobalSurgeEligible, true);
});

test('IAP Webhook - 6. Idempotency (Duplicate Prevention)', async () => {
  const headers = { authorization: 'Bearer rc_secret_token_123' };

  const payload = {
    event: {
      id: 'e_idem_01',
      type: 'INITIAL_PURCHASE',
      product_id: 'cluetri_wallet_starter',
      app_user_id: 'u_idem',
      transaction_id: 'tx_idem_fixed_123',
    },
  };

  const mock1 = createMockReqRes({ headers, body: payload });
  await iapWebhookHandler(mock1.req, mock1.res);
  assert.equal(mock1.getStatus(), 200);
  assert.equal(mock1.getBody().result.alreadyProcessed, false);

  const balanceAfter1 = (await db.collection(COLLECTIONS.WALLETS).doc('u_idem').get()).data()?.balancePaise;

  // Re-sending exact same transaction_id
  const mock2 = createMockReqRes({ headers, body: payload });
  await iapWebhookHandler(mock2.req, mock2.res);
  assert.equal(mock2.getStatus(), 200);
  assert.equal(mock2.getBody().result.alreadyProcessed, true);

  // Verify balance was NOT double-credited
  const balanceAfter2 = (await db.collection(COLLECTIONS.WALLETS).doc('u_idem').get()).data()?.balancePaise;
  assert.equal(balanceAfter1, balanceAfter2);
});

test('IAP Webhook - 7. Auto-Renewing Subscriptions & Expiration', async () => {
  const headers = { authorization: 'Bearer rc_secret_token_123' };

  // Subscribed
  const mockSub = createMockReqRes({
    headers,
    body: {
      event: {
        id: 'e_sub_01',
        type: 'INITIAL_PURCHASE',
        product_id: 'cluetri_pro_monthly',
        app_user_id: 'u_pro_subscriber',
        transaction_id: 'tx_sub_01',
        expiration_at_ms: Date.now() + 30 * 24 * 3600 * 1000,
      },
    },
  });
  await iapWebhookHandler(mockSub.req, mockSub.res);
  const userSub = await db.collection(COLLECTIONS.USERS).doc('u_pro_subscriber').get();
  assert.equal(userSub.data()?.isPro, true);
  assert.equal(userSub.data()?.tier, 'PRO');

  // Expired
  const mockExp = createMockReqRes({
    headers,
    body: {
      event: {
        id: 'e_sub_02',
        type: 'EXPIRATION',
        product_id: 'cluetri_pro_monthly',
        app_user_id: 'u_pro_subscriber',
        transaction_id: 'tx_sub_02',
      },
    },
  });
  await iapWebhookHandler(mockExp.req, mockExp.res);
  const userExp = await db.collection(COLLECTIONS.USERS).doc('u_pro_subscriber').get();
  assert.equal(userExp.data()?.isPro, false);
  assert.equal(userExp.data()?.tier, 'FREE');
});

test('Coach Payouts - 8. Manual UPI Settlement Queue & 10% 194J TDS', async () => {
  await db.collection(COLLECTIONS.COACHES).doc('coach_payout_test').set({
    id: 'coach_payout_test',
    alias: 'Riya S.',
    withdrawablePaise: 50000, // ₹500
    upiVpa: 'riya@oksbi',
    kyc: {
      panNumber: 'ABCDE1234F',
      upiId: 'riya@oksbi',
    },
  });

  // Request payout of ₹300 (30,000 paise)
  const mockReq = createMockReqRes({
    body: {
      coachId: 'coach_payout_test',
      requestedPaise: 30000,
    },
  });

  await coachPayoutsHandler(mockReq.req, mockReq.res);
  assert.equal(mockReq.getStatus(), 200);

  const body = mockReq.getBody();
  assert.equal(body.success, true);
  assert.ok(body.payoutRequest.id);
  assert.equal(body.payoutRequest.status, 'PENDING_MANUAL_UPI');
  assert.equal(body.payoutRequest.coachUpiId, 'riya@oksbi');
  assert.equal(body.payoutRequest.requestedPaise, 30000);
  assert.equal(body.payoutRequest.tds194jPaise, 3000); // 10% TDS
  assert.equal(body.payoutRequest.netPayablePaise, 27000); // ₹270
  assert.equal(body.payoutRequest.netPayableInr, 270);

  // Coach withdrawable balance reduced to 20,000 paise (₹200)
  const coachDoc = await db.collection(COLLECTIONS.COACHES).doc('coach_payout_test').get();
  assert.equal(coachDoc.data()?.withdrawablePaise, 20000);

  // Request exceeding remaining balance should fail
  const mockExcess = createMockReqRes({
    body: {
      coachId: 'coach_payout_test',
      requestedPaise: 25000, // Only 20000 left
    },
  });
  await coachPayoutsHandler(mockExcess.req, mockExcess.res);
  assert.equal(mockExcess.getStatus(), 400);
  assert.equal(mockExcess.getBody().error, 'INSUFFICIENT_FUNDS');
});

test('Coach Payouts - 9. Admin Settlement via markPayoutSettled', async () => {
  process.env.ADMIN_SECRET_HEADER = 'founder_secret_key_999';

  const requestId = 'payout_req_founder_test';
  await db.collection(COLLECTIONS.PAYOUT_REQUESTS).doc(requestId).set({
    id: requestId,
    coachId: 'coach_settle_test',
    status: 'PENDING_MANUAL_UPI',
    coachUpiId: 'riya@oksbi',
    netPayableInr: 270,
  });

  await db.collection(COLLECTIONS.COACHES).doc('coach_settle_test').set({
    id: 'coach_settle_test',
    totalWithdrawnInr: 100,
  });

  // Unauthorized request should fail with 401
  const mockUnauth = createMockReqRes({
    headers: {},
    body: {
      requestId,
      utrNumber: 'UTR_BANK_12345678',
    },
  });
  await markPayoutSettledHandler(mockUnauth.req, mockUnauth.res);
  assert.equal(mockUnauth.getStatus(), 401);

  // Authorized request with x-admin-secret header succeeds
  const mockAuth = createMockReqRes({
    headers: {
      'x-admin-secret': 'founder_secret_key_999',
    },
    body: {
      requestId,
      utrNumber: 'UTR_BANK_12345678',
    },
  });
  await markPayoutSettledHandler(mockAuth.req, mockAuth.res);
  assert.equal(mockAuth.getStatus(), 200);

  const updatedReq = await db.collection(COLLECTIONS.PAYOUT_REQUESTS).doc(requestId).get();
  assert.equal(updatedReq.data()?.status, 'PAID');
  assert.equal(updatedReq.data()?.utrNumber, 'UTR_BANK_12345678');
  assert.ok(updatedReq.data()?.settledAt);

  const updatedCoach = await db.collection(COLLECTIONS.COACHES).doc('coach_settle_test').get();
  assert.equal(updatedCoach.data()?.totalWithdrawnInr, 370); // 100 + 270
});

test('Monolithic Router - 10. cluetriApi Routing', async () => {
  // Health check
  const mockHealth = createMockReqRes({ path: '/health', method: 'GET' });
  await cluetriApiHandler(mockHealth.req, mockHealth.res);
  assert.equal(mockHealth.getStatus(), 200);
  assert.equal(mockHealth.getBody().status, 'healthy');
  assert.ok(mockHealth.getBody().endpoints.includes('POST /iapWebhook'));
  assert.ok(mockHealth.getBody().endpoints.includes('POST /markPayoutSettled'));
});
