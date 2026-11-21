import type { Request, Response } from '@google-cloud/functions-framework';
import type { Transaction } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db } from '../config/firebaseAdmin.js';
import { COLLECTIONS } from '../types/firestore.types.js';
import type { LiveSessionDoc, CoachDoc, WalletDoc } from '../types/firestore.types.js';
import { getCoachRatePaise, getTierFromCountry, StoreTier } from '../config/storeCatalog.js';

const GLOBAL_SURGE_COUNTRIES = new Set(['US', 'GB', 'CA', 'AU', 'DE', 'FR']);

const WarRoomActionSchema = z.discriminatedUnion('action', [
  // 1. START_SOS (or ring_sos)
  z.object({
    action: z.literal('START_SOS'),
    userId: z.string().default('anon-customer'),
    coachId: z.string().optional(),
    dialect: z.string().optional().default('Metro Hinglish'),
    attachedScanId: z.string().min(1, 'attachedScanId is required'),
    pppTier: z.string().optional(),
    clientAlias: z.string().optional().default('Agent_Vikram'),
    clientLocation: z.string().optional().default('Bangalore, India • Metro Hinglish'),
    clientPlatform: z.string().optional().default('Hinge'),
    targetName: z.string().optional().default('Pooja, 26'),
    targetAge: z.number().optional().default(26),
  }),

  // Alias for backward compatibility
  z.object({
    action: z.literal('ring_sos'),
    clientId: z.string().default('anon-customer'),
    clientAlias: z.string().default('Agent_Vikram'),
    clientLocation: z.string().default('Bangalore, India • Metro Hinglish'),
    clientPlatform: z.string().default('Hinge'),
    targetName: z.string().default('Pooja, 26'),
    targetAge: z.number().optional().default(26),
    lastMessage: z.string().default("Haha you think you are pretty smooth don't you? 👀"),
    behavioralTrap: z.string().default('Apologetic Defense & Seeking Approval'),
    recommendedStrategy: z.string().default('Agree & Exaggerate frame flip'),
    isInternationalSurge: z.boolean().default(false),
    attachedScanId: z.string().optional(),
    dialect: z.string().optional(),
    coachId: z.string().optional(),
    pppTier: z.string().optional(),
  }),

  // 2. PASS_TO_NEXT_COACH
  z.object({
    action: z.literal('PASS_TO_NEXT_COACH'),
    sessionId: z.string().min(1, 'sessionId is required'),
    currentCoachId: z.string().optional(),
  }),

  // 3. BILLING_HEARTBEAT
  z.object({
    action: z.literal('BILLING_HEARTBEAT'),
    sessionId: z.string().min(1, 'sessionId is required'),
    userId: z.string().optional(),
    coachId: z.string().optional(),
  }),

  // 4. COMPLETE_PHOTO_ROAST
  z.object({
    action: z.literal('COMPLETE_PHOTO_ROAST'),
    auditId: z.string().min(1, 'auditId is required'),
    coachId: z.string().min(1, 'coachId is required'),
    tags: z.array(z.string()).optional().default([]),
    promptRewrite: z.string().optional().default(''),
    voiceSummaryUrl: z.string().optional().default(''),
    voiceSummaryDurationSeconds: z.number().optional().default(45),
  }),

  // 5. ACCEPT SOS (Coach Claims Ringing Call)
  z.object({
    action: z.literal('accept_sos'),
    sessionId: z.string().min(1, 'sessionId is required'),
    coachId: z.string().min(1, 'coachId is required'),
    coachAlias: z.string().default('Riya S.'),
  }),

  // 6. COACH DUTY HEARTBEAT
  z.object({
    action: z.literal('heartbeat'),
    coachId: z.string().min(1, 'coachId is required'),
    isDutyOn: z.boolean().default(true),
  }),

  // 7. SLASH MACRO
  z.object({
    action: z.literal('slash_macro'),
    sessionId: z.string().min(1, 'sessionId is required'),
    macroKey: z.enum(['/1', '/2', '/3', '/4']),
    text: z.string().min(1),
    coachAlias: z.string().default('Riya S.'),
  }),

  // 8. END SESSION
  z.object({
    action: z.literal('end_session'),
    sessionId: z.string().min(1, 'sessionId is required'),
  }),
]);

export async function liveWarRoomHandler(req: Request, res: Response): Promise<void> {
  // CORS configuration
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-appengine-country, cf-ipcountry');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
    return;
  }

  try {
    const parseResult = WarRoomActionSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Invalid war room action payload',
        details: parseResult.error.flatten(),
      });
      return;
    }

    const payload = parseResult.data;

    // =========================================================================
    // ACTION 1: START_SOS (or ring_sos)
    // =========================================================================
    if (payload.action === 'START_SOS' || payload.action === 'ring_sos') {
      const userId = 'userId' in payload ? payload.userId : payload.clientId;
      const clientAlias = payload.clientAlias || 'Agent_Vikram';
      const clientLocation = payload.clientLocation || 'Bangalore, India • Metro Hinglish';
      const clientPlatform = payload.clientPlatform || 'Hinge';
      const requestedCoachId = payload.coachId;
      const requestedDialect = ('dialect' in payload ? payload.dialect : undefined) || 'Metro Hinglish';
      const attachedScanId = ('attachedScanId' in payload ? payload.attachedScanId : undefined) || 'scan_default';

      // 1. Detect Country & Global Surge
      const rawCountryHeader =
        req.headers['cf-ipcountry'] ||
        req.headers['x-country-code'] ||
        req.headers['x-appengine-country'] ||
        req.headers['x-vercel-ip-country'] ||
        'IN';
      const detectedCountry = (
        Array.isArray(rawCountryHeader) ? rawCountryHeader[0] : rawCountryHeader || 'IN'
      ).toUpperCase();

      const userWalletDoc = await db.collection(COLLECTIONS.WALLETS).doc(userId).get();
      const userWalletData = userWalletDoc.exists ? (userWalletDoc.data() as WalletDoc) : null;
      const userStoreTier = userWalletData?.lastPurchaseTier || getTierFromCountry(detectedCountry);

      const isRequestedSurge =
        ('isInternationalSurge' in payload && payload.isInternationalSurge === true) ||
        payload.pppTier === 'TIER_1_USD' ||
        payload.pppTier === 'TIER_1' ||
        userStoreTier === 'TIER_1';

      const isGlobalSurge = isRequestedSurge || GLOBAL_SURGE_COUNTRIES.has(detectedCountry);
      const pppTier = isGlobalSurge ? 'TIER_1_USD' : 'TIER_3_INR';

      // 2. Match Customer with Online Coach or Auto-route matching dialect
      let matchedCoachId = requestedCoachId;
      let matchedCoachAlias = 'Riya S.';
      let matchedCoachRating = 4.9;

      const onlineCoachesQuery = await db
        .collection(COLLECTIONS.COACHES)
        .where('isDutyOn', '==', true)
        .get();

      const onlineCoaches = onlineCoachesQuery.docs.map((d) => ({
        ...(d.data() as CoachDoc),
        id: d.id,
      }));

      if (requestedCoachId) {
        const found = onlineCoaches.find((c) => c.id === requestedCoachId);
        if (found) {
          matchedCoachId = found.id;
          matchedCoachAlias = found.alias || 'Wingwoman Riya';
          matchedCoachRating = found.rating || 4.9;
        } else {
          matchedCoachId = undefined; // Fall back to dialect router
        }
      }

      if (!matchedCoachId) {
        // Auto-route to next ONLINE coach matching dialect
        const lowerDialect = requestedDialect.toLowerCase();
        const dialectMatch = onlineCoaches.find((c) => {
          if (c.dialect && typeof c.dialect === 'string') {
            return c.dialect.toLowerCase().includes(lowerDialect);
          }
          if (Array.isArray(c.dialects)) {
            return c.dialects.some((d) => d.toLowerCase().includes(lowerDialect));
          }
          return false;
        });

        if (dialectMatch) {
          matchedCoachId = dialectMatch.id;
          matchedCoachAlias = dialectMatch.alias || 'Riya S.';
          matchedCoachRating = dialectMatch.rating || 4.9;
        } else if (onlineCoaches.length > 0 && onlineCoaches[0]) {
          // Fallback to first available online coach
          const firstCoach = onlineCoaches[0];
          matchedCoachId = firstCoach.id;
          matchedCoachAlias = firstCoach.alias || 'Riya S.';
          matchedCoachRating = firstCoach.rating || 4.9;
        } else {
          // If no coach online in DB, initialize / route to lead wingwoman
          matchedCoachId = 'coach_riya_s';
          matchedCoachAlias = 'Riya S.';
        }
      }

      // 3. Attach scans/{attachedScanId}
      let attachedScanData: {
        scanId: string;
        blurredScreenshotUrl: string;
        icfuState: string;
        badDraft: string;
        herMessage: string;
      } = {
        scanId: attachedScanId,
        blurredScreenshotUrl: `https://storage.googleapis.com/cluetri-scans/blurred_${attachedScanId}.jpg`,
        icfuState: 'CHALLENGE',
        badDraft: 'Haha sounds fun, what are you doing later?',
        herMessage: "Haha you think you are pretty smooth don't you? 👀",
      };

      if (attachedScanId && attachedScanId !== 'scan_default') {
        const scanDoc = await db.collection(COLLECTIONS.SCANS).doc(attachedScanId).get();
        if (scanDoc.exists) {
          const s = scanDoc.data();
          attachedScanData = {
            scanId: attachedScanId,
            blurredScreenshotUrl:
              (s?.blurredScreenshotUrl as string) ||
              `https://storage.googleapis.com/cluetri-scans/blurred_${attachedScanId}.jpg`,
            icfuState: (s?.icfuCategory as string) || (s?.icfuState as string) || 'CHALLENGE',
            badDraft: (s?.userDraft as string) || (s?.badDraft as string) || '',
            herMessage: (s?.herMessage as string) || '',
          };
        } else {
          // Check situation collection backward compatibility
          const sitDoc = await db.collection(COLLECTIONS.SITUATIONS).doc(attachedScanId).get();
          if (sitDoc.exists) {
            const sit = sitDoc.data();
            attachedScanData = {
              scanId: attachedScanId,
              blurredScreenshotUrl: `https://storage.googleapis.com/cluetri-scans/blurred_${attachedScanId}.jpg`,
              icfuState: (sit?.icfuCategory as string) || 'CHALLENGE',
              badDraft: (sit?.userDraft as string) || '',
              herMessage: (sit?.herMessage as string) || '',
            };
          }
        }
      }

      // 4. Create Session with 22-second ringing timer
      const sessionRef = db.collection(COLLECTIONS.LIVE_SESSIONS).doc();
      const ringingExpiresAt = new Date(Date.now() + 22000); // 22s ringing window

      const newSession: LiveSessionDoc = {
        id: sessionRef.id,
        sessionId: sessionRef.id,
        clientId: userId,
        clientAlias,
        coachId: matchedCoachId,
        coachAlias: matchedCoachAlias,
        status: 'RINGING',
        isGlobalSurge,
        isInternationalSurge: isGlobalSurge,
        pppTier,
        lastPurchaseTier: userStoreTier,
        paidSecondsRemaining: userWalletData?.paidSecondsRemaining,
        surgeMultiplier: isGlobalSurge ? 1.5 : 1.0,
        ratePerMinuteInr: isGlobalSurge ? 22.5 : 20.0,
        bountyInr: 35,
        clientLocation,
        clientPlatform,
        targetName: 'targetName' in payload ? payload.targetName || 'Pooja, 26' : 'Pooja, 26',
        targetAge: 'targetAge' in payload ? payload.targetAge || 26 : 26,
        lastMessage: attachedScanData.herMessage,
        behavioralTrap: 'Apologetic Defense & Seeking Approval',
        recommendedStrategy: 'Agree & Exaggerate frame flip',
        attachedScanId,
        attachedScan: attachedScanData,
        trialBountyAwarded: false,
        ringingExpiresAt,
        durationSeconds: 0,
        teleprompterLogs: [
          {
            timestamp: new Date().toISOString(),
            sender: 'system',
            text: `[SYSTEM] SOS Call Dispatched. GlobalSurge=${isGlobalSurge} • Dialect=${requestedDialect} • Coach=${matchedCoachAlias}`,
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await sessionRef.set(newSession);

      // Also mirror to warRoomSessions for legacy client compatibility
      await db.collection(COLLECTIONS.WAR_ROOM_SESSIONS).doc(sessionRef.id).set(newSession, { merge: true });

      res.status(200).json({
        success: true,
        action: 'START_SOS',
        sessionId: sessionRef.id,
        coachId: matchedCoachId,
        coachAlias: matchedCoachAlias,
        coachRating: matchedCoachRating,
        isGlobalSurge,
        pppTier,
        ringingTimeoutMs: 22000,
        ringingExpiresAt: ringingExpiresAt.toISOString(),
        attachedScan: attachedScanData,
        session: newSession,
      });
      return;
    }

    // =========================================================================
    // ACTION 2: PASS_TO_NEXT_COACH (Sub-1s re-assignment & reset 22s ringing timer)
    // =========================================================================
    if (payload.action === 'PASS_TO_NEXT_COACH') {
      const { sessionId, currentCoachId } = payload;
      const sessionRef = db.collection(COLLECTIONS.LIVE_SESSIONS).doc(sessionId);
      const sessionDoc = await sessionRef.get();

      if (!sessionDoc.exists) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      const session = sessionDoc.data() as LiveSessionDoc;
      const passedList = (session.passedFromCoaches || []) as string[];
      if (currentCoachId && !passedList.includes(currentCoachId)) {
        passedList.push(currentCoachId);
      }
      if (session.coachId && !passedList.includes(session.coachId)) {
        passedList.push(session.coachId);
      }

      // Query online coaches
      const coachesSnapshot = await db
        .collection(COLLECTIONS.COACHES)
        .where('isDutyOn', '==', true)
        .get();

      const candidateCoaches = coachesSnapshot.docs
        .map((d) => ({ ...(d.data() as CoachDoc), id: d.id }))
        .filter((c) => !passedList.includes(c.id));

      let nextCoach = candidateCoaches[0];
      if (!nextCoach) {
        // Fallback to any online coach if all were visited
        const allOnline = coachesSnapshot.docs.map((d) => ({ ...(d.data() as CoachDoc), id: d.id }));
        nextCoach = allOnline.find((c) => c.id !== session.coachId) || allOnline[0] || {
          id: 'coach_ananya_m',
          alias: 'Ananya M.',
          rating: 4.85,
        };
      }

      const newRingingExpiresAt = new Date(Date.now() + 22000); // Reset 22s ringing timer

      const updatedLogs = [
        ...(session.teleprompterLogs || []),
        {
          timestamp: new Date().toISOString(),
          sender: 'system' as const,
          text: `[SYSTEM] Call passed to next Wingwoman: ${nextCoach.alias} (Timer reset: 22s).`,
        },
      ];

      await sessionRef.update({
        coachId: nextCoach.id,
        coachAlias: nextCoach.alias || 'Wingwoman Coach',
        ringingExpiresAt: newRingingExpiresAt,
        passedFromCoaches: passedList,
        teleprompterLogs: updatedLogs,
        updatedAt: new Date(),
      });

      // Mirror update
      await db.collection(COLLECTIONS.WAR_ROOM_SESSIONS).doc(sessionId).set(
        {
          coachId: nextCoach.id,
          coachAlias: nextCoach.alias || 'Wingwoman Coach',
          ringingExpiresAt: newRingingExpiresAt,
          updatedAt: new Date(),
        },
        { merge: true }
      );

      res.status(200).json({
        success: true,
        action: 'PASS_TO_NEXT_COACH',
        sessionId,
        newCoachId: nextCoach.id,
        newCoachAlias: nextCoach.alias,
        ringingExpiresAt: newRingingExpiresAt.toISOString(),
        ringingTimeoutMs: 22000,
      });
      return;
    }

    // =========================================================================
    // ACTION 3: BILLING_HEARTBEAT (Called every 60s while status == "ACTIVE")
    // =========================================================================
    if (payload.action === 'BILLING_HEARTBEAT') {
      const { sessionId } = payload;

      const result = await db.runTransaction(async (t: Transaction) => {
        const sessionRef = db.collection(COLLECTIONS.LIVE_SESSIONS).doc(sessionId);
        const sessionDoc = await t.get(sessionRef);

        if (!sessionDoc.exists) {
          throw new Error(`Session ${sessionId} not found`);
        }

        const session = sessionDoc.data() as LiveSessionDoc;
        const normalizedStatus = (session.status || '').toUpperCase();
        if (normalizedStatus !== 'ACTIVE') {
          throw new Error(`Billing heartbeat rejected: Session status is '${session.status}', expected 'ACTIVE'`);
        }

        const actualUserId = payload.userId || session.clientId || session.userId || 'anon-customer';
        const actualCoachId = payload.coachId || session.coachId;

        const walletRef = db.collection(COLLECTIONS.WALLETS).doc(actualUserId);
        const walletDoc = await t.get(walletRef);

        let freeTrialSecondsLeft = 300; // default 5 minutes
        let paidSecondsRemaining = 0;
        let balancePaise = 0;
        let balanceCents = 0;
        let clientTier: StoreTier = 'TIER_3';

        if (walletDoc.exists) {
          const wData = walletDoc.data() as WalletDoc;
          freeTrialSecondsLeft = wData.freeTrialSecondsLeft ?? 300;
          paidSecondsRemaining = wData.paidSecondsRemaining ?? 0;
          balancePaise = wData.balancePaise || 0;
          balanceCents = wData.balanceCents || 0;
          if (wData.lastPurchaseTier) {
            clientTier = wData.lastPurchaseTier;
          } else if (session.lastPurchaseTier) {
            clientTier = session.lastPurchaseTier;
          } else if (session.isGlobalSurge || session.pppTier === 'TIER_1_USD') {
            clientTier = 'TIER_1';
          } else if (session.pppTier === 'TIER_2_USD') {
            clientTier = 'TIER_2B';
          }
        } else {
          if (session.lastPurchaseTier) {
            clientTier = session.lastPurchaseTier;
          } else if (session.isGlobalSurge || session.pppTier === 'TIER_1_USD') {
            clientTier = 'TIER_1';
          } else if (session.pppTier === 'TIER_2_USD') {
            clientTier = 'TIER_2B';
          }
        }

        let coachEarnedPaise = 0;
        let userDeductedPaise = 0;
        let userDeductedCents = 0;
        let warning: string | null = null;
        const now = new Date();

        // 1. First consume free trial seconds (up to 300s)
        if (freeTrialSecondsLeft > 0) {
          const secondsConsumed = Math.min(60, freeTrialSecondsLeft);
          freeTrialSecondsLeft -= secondsConsumed;
          // During free trial minutes, coach base per-minute payout is 0 (they earn +₹35 bounty on recharge)
          coachEarnedPaise = 0;
        } else {
          // 2. Once free trial seconds reach 0:
          // Deduct 60 seconds from paidSecondsRemaining
          paidSecondsRemaining = Math.max(0, paidSecondsRemaining - 60);

          // Deduct legacy units for backward compatibility
          if (balancePaise > 0) {
            userDeductedPaise = Math.min(2000, balancePaise);
            balancePaise = Math.max(0, balancePaise - 2000);
          }
          if (balanceCents > 0) {
            userDeductedCents = Math.min(149, balanceCents);
            balanceCents = Math.max(0, balanceCents - 149);
          }

          // Fetch Coach Tier
          let coachTier: string | number = 'TIER_2';
          if (actualCoachId) {
            const coachRef = db.collection(COLLECTIONS.COACHES).doc(actualCoachId);
            const coachDoc = await t.get(coachRef);
            if (coachDoc.exists) {
              const cData = coachDoc.data() as CoachDoc;
              coachTier = cData.tier || cData.tierLevel || 'TIER_2';
            }
          }

          // Calculate coach earnings based on client's purchase tier and coach tier:
          // - TIER_3: ₹13.00/min (1300 paise) for Tier 2 coach, ₹18.00/min (1800 paise) for Tier 3 coach
          // - TIER_2A & TIER_2B: ₹18.00/min (1800 paise — 1.35x Regional Surge)
          // - TIER_1: ₹22.50/min (2250 paise — 1.5x Global Arbitrage Surge)
          coachEarnedPaise = getCoachRatePaise(clientTier, coachTier);

          // Low balance warning: If user wallet paid seconds < 60s (or legacy balance < 1 min)
          if (paidSecondsRemaining < 60 && balancePaise < 2000 && balanceCents < 149) {
            warning = 'LOW_BALANCE_45S';
          }

          // Credit coach's withdrawable balance
          if (actualCoachId && coachEarnedPaise > 0) {
            const coachRef = db.collection(COLLECTIONS.COACHES).doc(actualCoachId);
            const coachDoc = await t.get(coachRef);
            const currentWithdrawable = coachDoc.exists ? (coachDoc.data()?.withdrawablePaise || 0) : 0;
            const currentTotalEarnings = coachDoc.exists ? (coachDoc.data()?.totalEarningsInr || 0) : 0;

            t.set(
              coachRef,
              {
                withdrawablePaise: currentWithdrawable + coachEarnedPaise,
                totalEarningsInr: currentTotalEarnings + coachEarnedPaise / 100,
                updatedAt: now,
              },
              { merge: true }
            );
          }
        }

        // Update User Wallet
        t.set(
          walletRef,
          {
            id: actualUserId,
            userId: actualUserId,
            paidSecondsRemaining,
            balancePaise,
            balanceCents,
            freeTrialSecondsLeft,
            lastPurchaseTier: clientTier,
            updatedAt: now,
          },
          { merge: true }
        );

        // Update Session duration
        const durationSeconds = (session.durationSeconds || 0) + 60;
        t.update(sessionRef, {
          durationSeconds,
          updatedAt: now,
        });

        return {
          sessionId,
          durationSeconds,
          freeTrialSecondsLeft,
          paidSecondsRemaining,
          balancePaise,
          balanceCents,
          clientTier,
          coachEarnedPaise,
          userDeductedPaise,
          userDeductedCents,
          warning,
        };
      });

      res.status(200).json({
        success: true,
        action: 'BILLING_HEARTBEAT',
        ...result,
      });
      return;
    }

    // =========================================================================
    // ACTION 4: COMPLETE_PHOTO_ROAST
    // Atomically mark status = "COMPLETED" & credit +₹65 (6500 paise) to coach
    // =========================================================================
    if (payload.action === 'COMPLETE_PHOTO_ROAST') {
      const { auditId, coachId, tags, promptRewrite, voiceSummaryUrl, voiceSummaryDurationSeconds } = payload;

      const result = await db.runTransaction(async (t: Transaction) => {
        const auditRef = db.collection(COLLECTIONS.PHOTO_AUDITS).doc(auditId);
        const coachRef = db.collection(COLLECTIONS.COACHES).doc(coachId);

        const coachDoc = await t.get(coachRef);
        const currentWithdrawable = coachDoc.exists ? (coachDoc.data()?.withdrawablePaise || 0) : 0;
        const currentTotalEarnings = coachDoc.exists ? (coachDoc.data()?.totalEarningsInr || 0) : 0;
        const now = new Date();

        // 1. Mark photo_audits/{auditId} COMPLETED
        t.set(
          auditRef,
          {
            id: auditId,
            coachId,
            status: 'COMPLETED',
            redFlagTags: tags,
            promptRewrite,
            voiceSummaryUrl,
            voiceSummaryDurationSeconds: voiceSummaryDurationSeconds || 45,
            completedAt: now,
            updatedAt: now,
          },
          { merge: true }
        );

        // 2. Atomically credit +₹65 (6500 paise) to coaches/{coachId}.withdrawablePaise
        t.set(
          coachRef,
          {
            withdrawablePaise: currentWithdrawable + 6500,
            totalEarningsInr: currentTotalEarnings + 65,
            updatedAt: now,
          },
          { merge: true }
        );

        return {
          auditId,
          coachId,
          bountyCreditedPaise: 6500,
          newWithdrawablePaise: currentWithdrawable + 6500,
        };
      });

      res.status(200).json({
        success: true,
        action: 'COMPLETE_PHOTO_ROAST',
        ...result,
      });
      return;
    }

    // =========================================================================
    // ACTION 5: ACCEPT SOS (Coach Claims Ringing Call)
    // =========================================================================
    if (payload.action === 'accept_sos') {
      const { sessionId, coachId, coachAlias } = payload;
      const sessionRef = db.collection(COLLECTIONS.LIVE_SESSIONS).doc(sessionId);

      const session = await db.runTransaction(async (t: Transaction) => {
        const doc = await t.get(sessionRef);
        if (!doc.exists) {
          throw new Error(`Session ${sessionId} not found`);
        }
        const data = doc.data() as LiveSessionDoc;
        const statusUpper = (data.status || '').toUpperCase();
        if (statusUpper !== 'RINGING') {
          throw new Error(`Session is not ringing (current status: ${data.status})`);
        }

        const now = new Date();
        const updatedLogs = [
          ...(data.teleprompterLogs || []),
          {
            timestamp: now.toISOString(),
            sender: 'system' as const,
            text: `[SYSTEM] Coach ${coachAlias} accepted call. Audio line & teleprompter locked.`,
          },
        ];

        t.update(sessionRef, {
          coachId,
          coachAlias,
          status: 'ACTIVE',
          startedAt: now,
          teleprompterLogs: updatedLogs,
          updatedAt: now,
        });

        return {
          ...data,
          coachId,
          coachAlias,
          status: 'ACTIVE' as const,
          startedAt: now,
          teleprompterLogs: updatedLogs,
        };
      });

      // Mirror to warRoomSessions
      await db.collection(COLLECTIONS.WAR_ROOM_SESSIONS).doc(sessionId).set(
        {
          coachId,
          coachAlias,
          status: 'active',
          startedAt: new Date(),
          updatedAt: new Date(),
        },
        { merge: true }
      );

      res.status(200).json({
        success: true,
        action: 'accept_sos',
        sessionId,
        session,
      });
      return;
    }

    // =========================================================================
    // ACTION 6: COACH DUTY HEARTBEAT
    // =========================================================================
    if (payload.action === 'heartbeat') {
      const { coachId, isDutyOn } = payload;
      const coachRef = db.collection(COLLECTIONS.COACHES).doc(coachId);

      await coachRef.set(
        {
          id: coachId,
          isDutyOn,
          status: isDutyOn ? 'ONLINE' : 'OFFLINE',
          lastHeartbeatAt: new Date(),
          updatedAt: new Date(),
        },
        { merge: true }
      );

      const activeSnapshot = await db
        .collection(COLLECTIONS.COACHES)
        .where('isDutyOn', '==', true)
        .get();

      res.status(200).json({
        success: true,
        action: 'heartbeat',
        coachId,
        isDutyOn,
        activeCoachesOnline: activeSnapshot.size,
      });
      return;
    }

    // =========================================================================
    // ACTION 7: SLASH MACRO
    // =========================================================================
    if (payload.action === 'slash_macro') {
      const { sessionId, macroKey, text, coachAlias } = payload;
      const sessionRef = db.collection(COLLECTIONS.LIVE_SESSIONS).doc(sessionId);

      const logEntry = {
        timestamp: new Date().toISOString(),
        macroKey,
        text,
        sender: 'coach' as const,
      };

      const doc = await sessionRef.get();
      if (!doc.exists) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      const existingLogs = (doc.data()?.teleprompterLogs || []) as typeof logEntry[];
      await sessionRef.update({
        teleprompterLogs: [...existingLogs, logEntry],
        updatedAt: new Date(),
      });

      res.status(200).json({
        success: true,
        action: 'slash_macro',
        macroKey,
        injectedText: text,
        loggedBy: coachAlias,
      });
      return;
    }

    // =========================================================================
    // ACTION 8: END SESSION
    // =========================================================================
    if (payload.action === 'end_session') {
      const { sessionId } = payload;
      const sessionRef = db.collection(COLLECTIONS.LIVE_SESSIONS).doc(sessionId);

      const doc = await sessionRef.get();
      if (!doc.exists) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      const session = doc.data() as LiveSessionDoc;
      const now = new Date();
      await sessionRef.update({
        status: 'COMPLETED',
        endedAt: now,
        updatedAt: now,
      });

      await db.collection(COLLECTIONS.WAR_ROOM_SESSIONS).doc(sessionId).set(
        {
          status: 'completed',
          endedAt: now,
          updatedAt: now,
        },
        { merge: true }
      );

      res.status(200).json({
        success: true,
        action: 'end_session',
        sessionId,
        status: 'COMPLETED',
        durationSeconds: session.durationSeconds || 0,
      });
      return;
    }
  } catch (error) {
    console.error('[liveWarRoom] Handler Error:', error);
    res.status(500).json({
      error: 'War room action failed',
      message: error instanceof Error ? error.message : 'Unknown internal error',
    });
  }
}

export default liveWarRoomHandler;
