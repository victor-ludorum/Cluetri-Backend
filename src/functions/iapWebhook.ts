import type { Request, Response } from '@google-cloud/functions-framework';
import type { Transaction } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../config/firebaseAdmin.js';
import { COLLECTIONS } from '../types/firestore.types.js';
import { getTierFromCountry, StoreTier } from '../config/storeCatalog.js';

// Tier 1 Countries for 1.5x Global Surge rate (₹22.50/min instead of ₹15.00/min)
const GLOBAL_SURGE_COUNTRIES = new Set(['US', 'GB', 'CA', 'AU', 'DE', 'FR']);

// RevenueCat Webhook Event Types
export type RevenueCatEventType =
  | 'INITIAL_PURCHASE'
  | 'NON_RENEWING_PURCHASE'
  | 'RENEWAL'
  | 'PRODUCT_CHANGE'
  | 'CANCELLATION'
  | 'UNCANCELLATION'
  | 'BILLING_ISSUE'
  | 'SUBSCRIBER_ALIAS'
  | 'EXPIRATION'
  | string;

export interface RevenueCatWebhookBody {
  api_version?: string;
  event: {
    id: string;
    type: RevenueCatEventType;
    app_user_id: string;
    original_app_user_id?: string;
    product_id: string;
    transaction_id?: string;
    original_transaction_id?: string;
    purchased_at_ms?: number;
    expiration_at_ms?: number;
    country_code?: string;
    currency?: string;
    price_in_purchased_currency?: number;
    subscriber_attributes?: Record<
      string,
      { value: string; updated_at_ms?: number } | string | undefined
    >;
  };
}

/**
 * Safely extract custom subscriber attribute value
 */
function getSubscriberAttribute(
  attributes: RevenueCatWebhookBody['event']['subscriber_attributes'],
  key: string
): string | null {
  if (!attributes || typeof attributes !== 'object') return null;
  const raw = attributes[key];
  if (!raw) return null;
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'object' && 'value' in raw && typeof raw.value === 'string') {
    return raw.value.trim();
  }
  return null;
}

/**
 * HTTP POST /iapWebhook
 * Unified Apple StoreKit 2 & Google Play Billing server notification handler via RevenueCat
 */
export async function iapWebhookHandler(req: Request, res: Response): Promise<void> {
  // CORS configuration
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
    return;
  }

  // 1. Verify incoming RevenueCat Webhook Authorization Header
  const expectedAuthSecret = process.env.REVENUECAT_WEBHOOK_AUTH_HEADER;
  if (expectedAuthSecret) {
    const authHeader = (req.headers['authorization'] || req.headers['Authorization']) as string | undefined;
    const isBearerValid = authHeader === `Bearer ${expectedAuthSecret}`;
    const isDirectValid = authHeader === expectedAuthSecret;

    if (!authHeader || (!isBearerValid && !isDirectValid)) {
      console.error('[iapWebhook] Unauthorized webhook request. Invalid auth header.');
      res.status(401).json({
        error: 'UNAUTHORIZED_WEBHOOK',
        message: 'Invalid or missing Authorization: Bearer <REVENUECAT_WEBHOOK_AUTH_HEADER>',
      });
      return;
    }
  }

  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as RevenueCatWebhookBody;
    const event = body?.event;

    if (!event || !event.product_id) {
      res.status(400).json({
        error: 'INVALID_PAYLOAD',
        message: 'Missing required event or product_id in webhook body.',
      });
      return;
    }

    const {
      type: eventType,
      product_id: productId,
      country_code: rawCountryCode,
      expiration_at_ms: expirationAtMs,
    } = event;

    const userId = event.app_user_id || event.original_app_user_id || 'anon_user';
    const transactionId =
      event.transaction_id || event.id || event.original_transaction_id || `rc_tx_${Date.now()}`;

    const countryCode = (rawCountryCode || '').toUpperCase();
    const purchaseTier: StoreTier = getTierFromCountry(countryCode);
    const isGlobalSurgeEligible = purchaseTier === 'TIER_1' || GLOBAL_SURGE_COUNTRIES.has(countryCode);

    // Extract custom subscriber attributes passed from client SDK
    const activeSessionId =
      getSubscriberAttribute(event.subscriber_attributes, '$activeSessionId') ||
      getSubscriberAttribute(event.subscriber_attributes, 'activeSessionId');

    const recommendedByCoachId =
      getSubscriberAttribute(event.subscriber_attributes, '$recommendedByCoachId') ||
      getSubscriberAttribute(event.subscriber_attributes, 'recommendedByCoachId');

    const referralCode =
      getSubscriberAttribute(event.subscriber_attributes, '$referralCode') ||
      getSubscriberAttribute(event.subscriber_attributes, 'referralCode');

    // 2. Execute Idempotent Firestore Transaction keyed by store transaction_id
    const result = await db.runTransaction(async (t: Transaction) => {
      const now = new Date();

      // Check Idempotency: wallets/{userId}/transactions/{transactionId}
      const walletTxnRef = db
        .collection(COLLECTIONS.WALLETS)
        .doc(userId)
        .collection('transactions')
        .doc(transactionId);

      const existingTxn = await t.get(walletTxnRef);
      if (existingTxn.exists) {
        console.log(`[iapWebhook] Transaction '${transactionId}' already processed for user '${userId}'. Skipping.`);
        return { success: true, alreadyProcessed: true };
      }

      // Load User and Wallet documents
      const walletRef = db.collection(COLLECTIONS.WALLETS).doc(userId);
      const userRef = db.collection(COLLECTIONS.USERS).doc(userId);

      const walletDoc = await t.get(walletRef);
      const userDoc = await t.get(userRef);

      const walletData = walletDoc.exists ? walletDoc.data() : null;
      const firstTopUpBonusUsed = walletData?.firstTopUpBonusUsed === true;

      let creditedUnits = 0;
      let creditedSeconds = 0;
      let bonusApplied = false;
      let scanTokensAdded = 0;
      let photoAuditCreated = false;
      let deckUnlocked: string | null = null;
      let proStatusUpdated = false;

      // =======================================================================
      // A. CONSUMABLE WALLET TOP-UPS (INITIAL_PURCHASE / NON_RENEWING_PURCHASE)
      // =======================================================================
      const isConsumableWallet = [
        'cluetri_wallet_starter',
        'cluetri_wallet_popular',
        'cluetri_wallet_pro',
      ].includes(productId);

      if (
        (eventType === 'INITIAL_PURCHASE' || eventType === 'NON_RENEWING_PURCHASE') &&
        isConsumableWallet
      ) {
        // Evaluate First-Top-Up Bonus
        bonusApplied = !firstTopUpBonusUsed;

        if (productId === 'cluetri_wallet_starter') {
          // 300s (5 mins) -> 420s (7 mins) if bonus
          creditedSeconds = bonusApplied ? 420 : 300;
          creditedUnits = bonusApplied ? 14000 : 10000;
        } else if (productId === 'cluetri_wallet_popular') {
          // 720s (12 mins) -> 900s (15 mins) if bonus
          creditedSeconds = bonusApplied ? 900 : 720;
          creditedUnits = bonusApplied ? 28000 : 20000;
        } else if (productId === 'cluetri_wallet_pro') {
          // 1800s (30 mins) -> 2280s (38 mins) if bonus + 1 free photo roast token
          creditedSeconds = bonusApplied ? 2280 : 1800;
          creditedUnits = bonusApplied ? 70000 : 50000;
        }

        const currentBalancePaise = walletData?.balancePaise || 0;
        const newBalancePaise = currentBalancePaise + creditedUnits;

        const currentPaidSeconds = walletData?.paidSecondsRemaining || 0;
        const newPaidSeconds = currentPaidSeconds + creditedSeconds;

        const walletUpdatePayload: Record<string, unknown> = {
          id: userId,
          userId,
          paidSecondsRemaining: newPaidSeconds,
          lastPurchaseTier: purchaseTier,
          balancePaise: newBalancePaise,
          firstTopUpBonusUsed: true,
          updatedAt: now,
        };

        if (isGlobalSurgeEligible) {
          walletUpdatePayload.isGlobalSurgeEligible = true;
        }

        if (productId === 'cluetri_wallet_pro') {
          const currentAuditTokens = walletData?.photoAuditTokens || 0;
          walletUpdatePayload.photoAuditTokens = currentAuditTokens + 1;
          walletUpdatePayload.photoRoastTokens = (walletData?.photoRoastTokens || 0) + 1;
        }

        t.set(walletRef, walletUpdatePayload, { merge: true });

        // TRIAL-TO-PAID CONVERSION BOUNTY:
        // If $activeSessionId is present on a wallet top-up, award +₹35 (3500 paise) to coaches/{coachId}.withdrawablePaise
        if (activeSessionId) {
          const sessionRef = db.collection(COLLECTIONS.LIVE_SESSIONS).doc(activeSessionId);
          const sessionDoc = await t.get(sessionRef);

          let targetCoachId = recommendedByCoachId;
          let bountyAlreadyAwarded = false;

          if (sessionDoc.exists) {
            const sessionData = sessionDoc.data();
            targetCoachId = targetCoachId || sessionData?.coachId;
            bountyAlreadyAwarded = sessionData?.trialBountyAwarded === true;
          }

          if (targetCoachId && !bountyAlreadyAwarded) {
            const coachRef = db.collection(COLLECTIONS.COACHES).doc(targetCoachId);
            const coachDoc = await t.get(coachRef);
            const currentWithdrawable = coachDoc.exists ? (coachDoc.data()?.withdrawablePaise || 0) : 0;

            t.set(
              coachRef,
              {
                withdrawablePaise: currentWithdrawable + 3500, // +₹35 Trial Conversion Bounty
                updatedAt: now,
              },
              { merge: true }
            );

            if (sessionDoc.exists) {
              t.update(sessionRef, {
                trialBountyAwarded: true,
                updatedAt: now,
              });
            }
          }
        }
      }

      // =======================================================================
      // B. SINGLE SCAN TOKEN CONSUMABLE (cluetri_single_scan)
      // Credit +1 single-scan token to wallets/{userId}.scanTokens
      // =======================================================================
      if (productId === 'cluetri_single_scan') {
        const currentScanTokens = walletData?.scanTokens || 0;
        scanTokensAdded = 1;

        const walletScanPayload: Record<string, unknown> = {
          id: userId,
          userId,
          scanTokens: currentScanTokens + 1,
          singleScanUnlockTokens: (walletData?.singleScanUnlockTokens || 0) + 1,
          lastPurchaseTier: purchaseTier,
          updatedAt: now,
        };

        if (isGlobalSurgeEligible) {
          walletScanPayload.isGlobalSurgeEligible = true;
        }

        t.set(walletRef, walletScanPayload, { merge: true });
      }

      // =======================================================================
      // C. ASYNC PHOTO ROAST CONSUMABLE (cluetri_photo_roast_async)
      // Create a paid slot in photo_audits and credit +₹65 (6500 paise) to assigned coach
      // =======================================================================
      if (productId === 'cluetri_photo_roast_async') {
        photoAuditCreated = true;
        const photoAuditRef = db.collection(COLLECTIONS.PHOTO_AUDITS).doc();

        t.set(photoAuditRef, {
          id: photoAuditRef.id,
          userId,
          status: 'PENDING',
          transactionId,
          coachFeePaise: 6500, // ₹65 coach compensation
          coachId: recommendedByCoachId || null,
          paidAt: now,
          createdAt: now,
          updatedAt: now,
        });

        // Update buyer wallet with lastPurchaseTier and photo token
        const currentAuditTokens = walletData?.photoAuditTokens || 0;
        t.set(
          walletRef,
          {
            id: userId,
            userId,
            photoAuditTokens: currentAuditTokens + 1,
            photoRoastTokens: (walletData?.photoRoastTokens || 0) + 1,
            lastPurchaseTier: purchaseTier,
            updatedAt: now,
          },
          { merge: true }
        );

        // Credit +₹65 (6500 paise) to the assigned coach if specified
        if (recommendedByCoachId) {
          const coachRef = db.collection(COLLECTIONS.COACHES).doc(recommendedByCoachId);
          const coachDoc = await t.get(coachRef);
          const currentWithdrawable = coachDoc.exists ? (coachDoc.data()?.withdrawablePaise || 0) : 0;

          t.set(
            coachRef,
            {
              withdrawablePaise: currentWithdrawable + 6500, // +₹65 Coach Roast Fee
              updatedAt: now,
            },
            { merge: true }
          );
        }
      }

      // =======================================================================
      // D. NON-CONSUMABLE LIFETIME DECK UNLOCKS
      // deck_01_texting_icfu_a3 & deck_02_irl_oae_date_mastery
      // =======================================================================
      if (
        productId === 'deck_01_texting_icfu_a3' ||
        productId === 'deck_02_irl_oae_date_mastery'
      ) {
        deckUnlocked = productId;

        // Use FieldValue.arrayUnion or fallback array merge
        const existingUnlocked = Array.isArray(userDoc.data()?.unlockedDecks)
          ? [...(userDoc.data()?.unlockedDecks as string[])]
          : [];
        if (!existingUnlocked.includes(productId)) {
          existingUnlocked.push(productId);
        }

        t.set(
          userRef,
          {
            unlockedDecks: existingUnlocked,
            updatedAt: now,
          },
          { merge: true }
        );

        t.set(
          walletRef,
          {
            id: userId,
            userId,
            lastPurchaseTier: purchaseTier,
            updatedAt: now,
          },
          { merge: true }
        );

        // AFFILIATE BONUS: If $recommendedByCoachId is present on a deck unlock, award +₹30 (3000 paise)
        if (recommendedByCoachId) {
          const coachRef = db.collection(COLLECTIONS.COACHES).doc(recommendedByCoachId);
          const coachDoc = await t.get(coachRef);
          const currentWithdrawable = coachDoc.exists ? (coachDoc.data()?.withdrawablePaise || 0) : 0;

          t.set(
            coachRef,
            {
              withdrawablePaise: currentWithdrawable + 3000, // +₹30 Coach Affiliate Bonus
              updatedAt: now,
            },
            { merge: true }
          );
        }
      }

      // =======================================================================
      // E. AUTO-RENEWING SUBSCRIPTIONS (INITIAL_PURCHASE, RENEWAL, EXPIRATION)
      // cluetri_pro_monthly, cluetri_pro_quarterly, cluetri_pro_yearly
      // =======================================================================
      const isSubscription = [
        'cluetri_pro_monthly',
        'cluetri_pro_quarterly',
        'cluetri_pro_yearly',
      ].includes(productId);

      if (isSubscription) {
        proStatusUpdated = true;
        if (eventType === 'EXPIRATION') {
          t.set(
            userRef,
            {
              isPro: false,
              tier: 'FREE',
              proExpiresAt: expirationAtMs ? new Date(expirationAtMs) : now,
              updatedAt: now,
            },
            { merge: true }
          );
        } else {
          // INITIAL_PURCHASE or RENEWAL
          const proExpiresAt = expirationAtMs
            ? new Date(expirationAtMs)
            : new Date(now.getTime() + 30 * 24 * 3600 * 1000);

          t.set(
            userRef,
            {
              isPro: true,
              tier: 'PRO',
              proExpiresAt,
              proSubscribedAt: now,
              updatedAt: now,
            },
            { merge: true }
          );
        }
      }

      // Tag wallet with lastPurchaseTier & isGlobalSurgeEligible
      if (!isConsumableWallet && !productId.startsWith('cluetri_single_scan')) {
        const walletMetaPayload: Record<string, unknown> = {
          id: userId,
          userId,
          lastPurchaseTier: purchaseTier,
          updatedAt: now,
        };
        if (isGlobalSurgeEligible) {
          walletMetaPayload.isGlobalSurgeEligible = true;
        }
        t.set(walletRef, walletMetaPayload, { merge: true });
      }

      // =======================================================================
      // F. WRITE IDEMPOTENT TRANSACTION RECEIPT
      // wallets/{userId}/transactions/{transactionId}
      // =======================================================================
      t.set(walletTxnRef, {
        id: transactionId,
        transactionId,
        userId,
        productId,
        type: eventType,
        creditedUnits,
        creditedSeconds,
        bonusApplied,
        scanTokensAdded,
        photoAuditCreated,
        deckUnlocked,
        proStatusUpdated,
        countryCode,
        purchaseTier,
        isGlobalSurgeEligible,
        activeSessionId: activeSessionId || null,
        recommendedByCoachId: recommendedByCoachId || null,
        referralCode: referralCode || null,
        status: 'succeeded',
        rawEventId: event.id,
        createdAt: now,
      });

      return {
        success: true,
        alreadyProcessed: false,
        transactionId,
        creditedUnits,
        creditedSeconds,
        bonusApplied,
        scanTokensAdded,
        deckUnlocked,
        lastPurchaseTier: purchaseTier,
        isGlobalSurgeEligible,
      };
    });

    console.log(`[iapWebhook] Successfully processed event '${event.id}' (${eventType}):`, result);
    res.status(200).json({ status: 'ok', received: true, result });
  } catch (error) {
    console.error('[iapWebhook] Processing error:', error);
    res.status(500).json({
      error: 'IAP_WEBHOOK_PROCESSING_FAILED',
      message: error instanceof Error ? error.message : 'Unknown internal error',
    });
  }
}

export default iapWebhookHandler;
