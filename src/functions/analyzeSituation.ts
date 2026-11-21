import type { Request, Response } from '@google-cloud/functions-framework';
import { z } from 'zod';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../config/firebaseAdmin.js';
import { COLLECTIONS } from '../types/firestore.types.js';
import type { ScanDoc, ScanInputMode } from '../types/firestore.types.js';
import { geminiService } from '../services/geminiService.js';
import { verifyOptionalFirebaseAuth, FirebaseAuthError } from '../middleware/verifyAuth.js';

const AnalyzeSituationSchema = z.object({
  userId: z.string().min(1).optional(),
  inputMode: z.enum(['paste', 'screenshot', 'voice']).default('paste'),
  herMessage: z.string().min(1, 'herMessage is required'),
  userDraft: z.string().optional().default(''),
  region: z.string().default('IN_METRO'),
  dialect: z.string().optional().default('Metro Hinglish'),
  platform: z.string().default('Hinge'),
  prospectId: z.string().optional(),
});

export async function analyzeSituationHandler(req: Request, res: Response): Promise<void> {
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

  try {
    let verifiedUser;
    try {
      verifiedUser = await verifyOptionalFirebaseAuth(req);
    } catch (authErr) {
      if (authErr instanceof FirebaseAuthError) {
        res.status(authErr.statusCode).json({ error: authErr.message });
        return;
      }
      throw authErr;
    }

    const parseResult = AnalyzeSituationSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Invalid request body',
        details: parseResult.error.flatten(),
      });
      return;
    }

    const { userId: bodyUserId, inputMode, herMessage, userDraft, region, dialect, platform, prospectId } =
      parseResult.data;

    const userId = verifiedUser?.uid || bodyUserId;
    if (!userId) {
      res.status(401).json({
        error: 'Authentication required. Sign in with Google or Email/Password or provide userId.',
      });
      return;
    }

    // 1. Verify User Entitlement: isPro == true, free daily scans remaining, or single-scan unlock token
    const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
    const walletRef = db.collection(COLLECTIONS.WALLETS).doc(userId);

    const [userSnap, walletSnap] = await Promise.all([userRef.get(), walletRef.get()]);

    const userData = userSnap.data();
    const walletData = walletSnap.data();

    const isPro = Boolean(userData?.isPro || userData?.tier === 'PRO');
    const todayStr = new Date().toISOString().slice(0, 10);

    let hasAccess = false;
    let accessSource = 'NONE';

    if (isPro) {
      hasAccess = true;
      accessSource = 'PRO_SUBSCRIPTION';
    } else {
      // Check free daily scans
      const lastDailyReset = userData?.lastScanDate || walletData?.lastDailyScanReset;
      let freeDailyRemaining =
        userData?.freeDailyScansRemaining ??
        walletData?.freeDailyScansRemaining ??
        userData?.freeDailyScans ??
        3; // default 3 free scans

      // If it's a new day, refresh free daily scans
      if (lastDailyReset !== todayStr) {
        freeDailyRemaining = 3;
      }

      if (freeDailyRemaining > 0) {
        hasAccess = true;
        accessSource = 'FREE_DAILY_SCAN';
        // Decrement free daily scan
        const newCount = freeDailyRemaining - 1;
        const batch = db.batch();
        batch.set(
          userRef,
          {
            freeDailyScansRemaining: newCount,
            lastScanDate: todayStr,
            updatedAt: new Date(),
          },
          { merge: true }
        );
        batch.set(
          walletRef,
          {
            userId,
            freeDailyScansRemaining: newCount,
            lastDailyScanReset: todayStr,
            updatedAt: new Date(),
          },
          { merge: true }
        );
        await batch.commit().catch((err: unknown) => {
          console.warn('[analyzeSituation] Daily quota update warning:', err);
        });
      } else {
        // Check single-scan unlock token in wallets/{userId}
        const singleScanTokens = Number(walletData?.singleScanUnlockTokens || 0);
        if (singleScanTokens > 0) {
          hasAccess = true;
          accessSource = 'SINGLE_SCAN_TOKEN';
          // Consume 1 single-scan unlock token
          await walletRef
            .update({
              singleScanUnlockTokens: FieldValue.increment(-1),
              updatedAt: new Date(),
            })
            .catch(async () => {
              await walletRef.set(
                {
                  userId,
                  singleScanUnlockTokens: singleScanTokens - 1,
                  updatedAt: new Date(),
                },
                { merge: true }
              );
            });
        }
      }
    }

    if (!hasAccess) {
      res.status(402).json({
        error: 'PAYMENT_REQUIRED',
        message:
          'No scans remaining. Upgrade to Cluetri Pro or unlock an individual scan token to continue.',
        quota: {
          isPro: false,
          freeDailyScansRemaining: 0,
          singleScanUnlockTokens: 0,
        },
      });
      return;
    }

    // 2. Call Gemini 2.5 Flash via geminiService
    const diagnostic = await geminiService.analyzeSituation({
      herMessage,
      userDraft,
      region,
      dialect,
      platform,
    });

    // 3. Query Firestore `cards` collection for 2 matching flashcards where icfu_stage == icfuCategory
    let attachedCardIds: string[] = [];
    try {
      const cardsSnapshot = await db
        .collection(COLLECTIONS.CARDS)
        .where('icfu_stage', '==', diagnostic.icfuCategory)
        .limit(2)
        .get();

      if (!cardsSnapshot.empty) {
        attachedCardIds = cardsSnapshot.docs.map(
          (doc) => (doc.data().card_id as string) || doc.id
        );
      } else {
        // Fallback query by tag
        const fallbackTag = diagnostic.icfuCategory.startsWith('CHALLENGE')
          ? 'CHALLENGE'
          : diagnostic.icfuCategory === 'UNRESPONSIVE'
            ? 'STALL'
            : diagnostic.icfuCategory;

        const fallbackSnap = await db
          .collection(COLLECTIONS.CARDS)
          .where('icfuTag', '==', fallbackTag)
          .limit(2)
          .get();

        if (!fallbackSnap.empty) {
          attachedCardIds = fallbackSnap.docs.map(
            (doc) => (doc.data().card_id as string) || doc.id
          );
        }
      }
    } catch (queryErr) {
      console.warn('[analyzeSituation] Card lookup warning:', queryErr);
    }

    // 4. Save result to scans/{scanId}
    const scanRef = db.collection(COLLECTIONS.SCANS).doc();
    const scanData: ScanDoc = {
      id: scanRef.id,
      scanId: scanRef.id,
      userId,
      prospectId,
      inputMode: inputMode as ScanInputMode,
      herMessage,
      userDraft,
      region,
      dialect,
      platform,
      icfuCategory: diagnostic.icfuCategory,
      conversationStage: diagnostic.conversationStage,
      interestScore: diagnostic.interestScore,
      yappingRatioWarning: diagnostic.yappingRatioWarning,
      draftCritique: diagnostic.draftCritique,
      calibratedMoves: diagnostic.calibratedMoves,
      matchingCardIds: attachedCardIds,
      card_ids: attachedCardIds,
      telemetry: diagnostic.telemetry,
      trapWarning: diagnostic.trapWarning,
      critique: diagnostic.critique,
      rawGeminiResponse: diagnostic.rawGeminiResponse,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await scanRef.set(scanData);

    // If prospectId provided, update prospect tension state
    if (prospectId) {
      const prospectRef = db.collection(COLLECTIONS.PROSPECTS).doc(prospectId);
      await prospectRef
        .update({
          tensionState: diagnostic.icfuCategory,
          recommendedMove: diagnostic.calibratedMoves[0]?.reply || '',
          updatedAt: new Date(),
        })
        .catch((err: unknown) => {
          console.warn(`[analyzeSituation] Could not update prospect ${prospectId}:`, err);
        });
    }

    // 5. Return JSON payload
    res.status(200).json({
      success: true,
      scanId: scanRef.id,
      accessSource,
      data: scanData,
    });
  } catch (error) {
    console.error('[analyzeSituation] Handler Error:', error);
    res.status(500).json({
      error: 'Failed to analyze situation',
      message: error instanceof Error ? error.message : 'Unknown internal error',
    });
  }
}
