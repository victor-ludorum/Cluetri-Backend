import type { Request, Response } from '@google-cloud/functions-framework';
import type { Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';
import crypto from 'crypto';
import { db } from '../config/firebaseAdmin.js';
import { COLLECTIONS } from '../types/firestore.types.js';
import type { CoachDoc, PayoutRequestDoc } from '../types/firestore.types.js';

const RequestCoachPayoutSchema = z.object({
  coachId: z.string().min(1, 'coachId is required'),
  requestedPaise: z.number().positive().optional(),
  amountInr: z.number().positive().optional(),
  upiId: z.string().optional(),
});

const MarkPayoutSettledSchema = z.object({
  requestId: z.string().min(1, 'requestId is required'),
  utrNumber: z.string().min(1, 'utrNumber is required'),
});

/**
 * HTTP POST /requestCoachPayout
 * Deducts requestedPaise from coaches/{coachId}.withdrawablePaise,
 * computes 10% Section 194J TDS, and enqueues into payout_requests/{requestId}
 * with status "PENDING_MANUAL_UPI".
 */
export async function coachPayoutsHandler(req: Request, res: Response): Promise<void> {
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
    const parseResult = RequestCoachPayoutSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Invalid payout request payload',
        details: parseResult.error.flatten(),
      });
      return;
    }

    const { coachId } = parseResult.data;

    let requestedPaise = parseResult.data.requestedPaise;
    if (!requestedPaise && parseResult.data.amountInr) {
      requestedPaise = Math.round(parseResult.data.amountInr * 100);
    }

    if (!requestedPaise || requestedPaise <= 0) {
      res.status(400).json({
        error: 'INVALID_AMOUNT',
        message: 'Either requestedPaise or amountInr must be provided and greater than 0.',
      });
      return;
    }

    const coachRef = db.collection(COLLECTIONS.COACHES).doc(coachId);
    const initialCoachDoc = await coachRef.get();

    if (!initialCoachDoc.exists) {
      res.status(404).json({
        error: 'COACH_NOT_FOUND',
        message: `Coach profile '${coachId}' was not found.`,
      });
      return;
    }

    const coachData = initialCoachDoc.data() as CoachDoc;
    const currentWithdrawable = coachData.withdrawablePaise || 0;

    if (currentWithdrawable < requestedPaise) {
      res.status(400).json({
        error: 'INSUFFICIENT_FUNDS',
        message: `Requested payout of ₹${(requestedPaise / 100).toLocaleString('en-IN')} (${requestedPaise} paise) exceeds available withdrawable balance of ₹${(currentWithdrawable / 100).toLocaleString('en-IN')} (${currentWithdrawable} paise).`,
      });
      return;
    }

    const coachUpiId =
      coachData.kyc?.upiId ||
      coachData.upiVpa ||
      parseResult.data.upiId ||
      'coach@upi';

    const panNumber =
      coachData.kyc?.panNumber ||
      coachData.panNumber ||
      'PAN_NOT_PROVIDED';

    // Execute atomic transaction: deduct balance and create payout_requests record
    const result = await db.runTransaction(async (t: Transaction) => {
      const freshCoachDoc = await t.get(coachRef);
      if (!freshCoachDoc.exists) {
        throw new Error(`Coach '${coachId}' not found`);
      }

      const freshCoachData = freshCoachDoc.data() as CoachDoc;
      const liveWithdrawable = freshCoachData.withdrawablePaise || 0;

      if (liveWithdrawable < requestedPaise) {
        throw new Error(
          `Insufficient balance: Requested ${requestedPaise} paise, available ${liveWithdrawable} paise.`
        );
      }

      // Calculate 10% Section 194J TDS under Indian Income Tax Act 1961
      const tds194jPaise = Math.round(requestedPaise * 0.10);
      const netPayablePaise = requestedPaise - tds194jPaise;
      const remainingWithdrawablePaise = liveWithdrawable - requestedPaise;

      const now = new Date();
      const payoutReqRef = db.collection(COLLECTIONS.PAYOUT_REQUESTS).doc();
      const requestId = payoutReqRef.id;

      // 1. Create document in payout_requests/{requestId}
      const payoutRequest: PayoutRequestDoc = {
        id: requestId,
        coachId,
        coachAlias: freshCoachData.alias || 'Cluetri Coach',
        status: 'PENDING_MANUAL_UPI',
        coachUpiId,
        requestedPaise,
        tds194jPaise,
        netPayablePaise,
        netPayableInr: netPayablePaise / 100,
        grossInr: requestedPaise / 100,
        panNumber,
        createdAt: now,
        updatedAt: now,
      };

      t.set(payoutReqRef, payoutRequest);

      // 2. Deduct requestedPaise from coaches/{coachId}.withdrawablePaise
      t.update(coachRef, {
        withdrawablePaise: remainingWithdrawablePaise,
        updatedAt: now,
      });

      // 3. Record transaction in top-level transactions for audit trail
      const txnRef = db.collection(COLLECTIONS.TRANSACTIONS).doc(requestId);
      const ledgerHash = crypto
        .createHash('sha256')
        .update(`PAYOUT_REQUEST:${requestId}:${coachId}:${requestedPaise}:${tds194jPaise}:${netPayablePaise}:${now.toISOString()}`)
        .digest('hex');

      t.set(txnRef, {
        id: requestId,
        coachId,
        type: 'coach_payout',
        amount: netPayablePaise / 100,
        currency: 'INR',
        gateway: 'manual_upi',
        status: 'PENDING_MANUAL_UPI',
        requestedPaise,
        tds194jPaise,
        netPayablePaise,
        vpa: coachUpiId,
        upiId: coachUpiId,
        panNumber,
        ledgerHash,
        metadata: {
          complianceVoucher: `VOUCHER-194J-${now.getTime()}`,
          payoutQueue: 'MANUAL_UPI_QUEUE',
        },
        createdAt: now,
        updatedAt: now,
      });

      return {
        requestId,
        payoutRequest,
        remainingWithdrawablePaise,
      };
    });

    res.status(200).json({
      success: true,
      message: `Payout request created. ₹${(result.payoutRequest.netPayableInr).toLocaleString('en-IN')} queued for manual UPI settlement.`,
      payoutRequest: result.payoutRequest,
      remainingWithdrawablePaise: result.remainingWithdrawablePaise,
    });
  } catch (error) {
    console.error('[coachPayouts] Handler Error:', error);
    res.status(400).json({
      error: 'PAYOUT_REQUEST_FAILED',
      message: error instanceof Error ? error.message : 'Unknown internal error',
    });
  }
}

/**
 * HTTP POST /markPayoutSettled
 * Founder admin endpoint to mark a manual UPI payout as PAID with the bank UTR
 * Protected by ADMIN_SECRET_HEADER.
 */
export async function markPayoutSettledHandler(req: Request, res: Response): Promise<void> {
  // CORS configuration
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-secret, admin-secret');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
    return;
  }

  // Verify ADMIN_SECRET_HEADER
  const expectedSecret = process.env.ADMIN_SECRET_HEADER;
  if (expectedSecret) {
    const authHeader = req.headers['authorization'] || req.headers['Authorization'];
    const customHeader =
      req.headers['x-admin-secret'] ||
      req.headers['admin-secret'] ||
      req.headers['admin_secret'];

    const isBearerValid = authHeader === `Bearer ${expectedSecret}`;
    const isDirectAuthValid = authHeader === expectedSecret;
    const isCustomValid = customHeader === expectedSecret;

    if (!isBearerValid && !isDirectAuthValid && !isCustomValid) {
      console.error('[markPayoutSettled] Unauthorized request. Missing or invalid admin secret.');
      res.status(401).json({
        error: 'UNAUTHORIZED_ADMIN',
        message: 'Missing or invalid ADMIN_SECRET_HEADER credentials.',
      });
      return;
    }
  }

  try {
    const parseResult = MarkPayoutSettledSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'INVALID_PAYLOAD',
        details: parseResult.error.flatten(),
      });
      return;
    }

    const { requestId, utrNumber } = parseResult.data;
    const payoutReqRef = db.collection(COLLECTIONS.PAYOUT_REQUESTS).doc(requestId);

    const result = await db.runTransaction(async (t: Transaction) => {
      const doc = await t.get(payoutReqRef);
      if (!doc.exists) {
        throw new Error(`Payout request '${requestId}' not found.`);
      }

      const payoutData = doc.data() as PayoutRequestDoc;
      if (payoutData.status === 'PAID') {
        return {
          alreadySettled: true,
          payoutRequest: payoutData,
        };
      }

      const now = new Date();
      const updatedFields = {
        status: 'PAID' as const,
        utrNumber,
        settledAt: now,
        updatedAt: now,
      };

      // 1. Update payout_requests document
      t.update(payoutReqRef, updatedFields);

      // 2. Update top-level transactions receipt
      const txnRef = db.collection(COLLECTIONS.TRANSACTIONS).doc(requestId);
      const txnDoc = await t.get(txnRef);
      if (txnDoc.exists) {
        t.update(txnRef, {
          status: 'PAID',
          utr: utrNumber,
          utrNumber,
          settledAt: now,
          updatedAt: now,
        });
      }

      // 3. Update coach totalWithdrawnInr
      if (payoutData.coachId) {
        const coachRef = db.collection(COLLECTIONS.COACHES).doc(payoutData.coachId);
        const coachDoc = await t.get(coachRef);
        if (coachDoc.exists) {
          const coachData = coachDoc.data() as CoachDoc;
          const currentTotal = coachData.totalWithdrawnInr || 0;
          t.update(coachRef, {
            totalWithdrawnInr: currentTotal + payoutData.netPayableInr,
            updatedAt: now,
          });
        }
      }

      return {
        alreadySettled: false,
        payoutRequest: {
          ...payoutData,
          ...updatedFields,
        },
      };
    });

    res.status(200).json({
      success: true,
      message: `Payout request '${requestId}' marked as PAID with UTR: ${utrNumber}.`,
      payoutRequest: result.payoutRequest,
    });
  } catch (error) {
    console.error('[markPayoutSettled] Error:', error);
    res.status(400).json({
      error: 'SETTLEMENT_FAILED',
      message: error instanceof Error ? error.message : 'Unknown internal error',
    });
  }
}

export default coachPayoutsHandler;
