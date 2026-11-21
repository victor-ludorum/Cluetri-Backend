import type { Timestamp } from 'firebase-admin/firestore';

export type FirestoreDate = Timestamp | Date | string;

// =============================================================================
// FIRESTORE COLLECTIONS CONSTANT
// =============================================================================
export const COLLECTIONS = {
  USERS: 'users',
  WALLETS: 'wallets',
  WALLET_TRANSACTIONS: 'wallet_transactions',
  TRANSACTIONS: 'transactions',
  PROSPECTS: 'prospects',
  SCANS: 'scans',
  SITUATIONS: 'situations', // backward-compatible alias
  DECKS: 'decks',
  CARDS: 'cards',
  COACHES: 'coaches',
  LIVE_SESSIONS: 'live_sessions',
  WAR_ROOM_SESSIONS: 'warRoomSessions', // backward-compatible alias
  PHOTO_AUDITS: 'photo_audits',
  VOICE_NOTES: 'voiceNotes',
  PAYOUTS: 'payouts',
  PAYOUT_REQUESTS: 'payout_requests',
} as const;

export type CollectionName = typeof COLLECTIONS[keyof typeof COLLECTIONS];

// =============================================================================
// 1. UserDoc (`users/{userId}`)
// =============================================================================
export type UserTier = 'FREE' | 'PRO';
export type PppTier = 'TIER_1_USD' | 'TIER_2_USD' | 'TIER_3_INR' | 'TIER_1' | 'TIER_2' | 'TIER_3';

export type ProductId =
  | 'SINGLE_SCAN_UNLOCK'
  | 'SINGLE_DECK_UNLOCK'
  | 'ASYNC_PHOTO_ROAST'
  | 'WALLET_PACK_STARTER'
  | 'WALLET_PACK_POPULAR'
  | 'WALLET_PACK_PRO'
  | 'COURTSHIP_OS_PRO_YEARLY';

export interface UserPreferences {
  region?: string;
  dialect?: string;
  stealthModeEnabled?: boolean;
  piiScrubberActive?: boolean;
  decoyTitlePreset?: string;
}

export interface UserDoc {
  id: string; // Firebase Auth UID
  uid?: string; // alias
  alias?: string;
  email?: string;
  phoneNumber?: string;
  isPro: boolean;
  proExpiresAt?: FirestoreDate;
  proSubscribedAt?: FirestoreDate;
  unlockedDecks: string[];
  singleScanUnlockTokens?: number;
  freeDailyScans: number;
  freeDailyScansRemaining?: number;
  lastScanDate?: string;
  tier?: UserTier;
  pppTier?: PppTier;
  countryCode?: string;
  wallet?: {
    credits: number;
    totalLoadedInr: number;
    totalLoadedUsd: number;
    currency: 'INR' | 'USD';
    lastRechargeAt?: FirestoreDate;
  };
  streakDays?: number;
  activeProspectCount?: number;
  preferences?: UserPreferences;
  createdAt: FirestoreDate;
  updatedAt: FirestoreDate;
}

// =============================================================================
// 2. WalletDoc (`wallets/{uid}`)
// =============================================================================
export interface WalletDoc {
  id: string; // Auth UID
  uid?: string;
  userId: string;
  singleScanUnlockTokens?: number;
  scanTokens?: number;
  photoAuditTokens?: number;
  photoRoastTokens?: number;
  freeDailyScansRemaining?: number;
  balancePaise: number;
  balanceCents?: number;
  paidSecondsRemaining?: number;
  lastPurchaseTier?: 'TIER_1' | 'TIER_2A' | 'TIER_2B' | 'TIER_3';
  firstTopUpBonusUsed?: boolean;
  freeTrialSecondsLeft?: number;
  credits?: number;
  currency: 'INR' | 'USD';
  isGlobalSurgeEligible?: boolean;
  lastDailyScanReset?: FirestoreDate;
  createdAt: FirestoreDate;
  updatedAt: FirestoreDate;
}

// =============================================================================
// 3. WalletTransactionDoc (`wallet_transactions/{txId}` / `transactions/{txId}`)
// =============================================================================
export type TransactionType =
  | 'credit_topup'
  | 'session_debit'
  | 'coach_payout'
  | 'bounty_credit'
  | 'single_scan_unlock'
  | 'deck_unlock'
  | string;

export type PaymentGateway = 'revenuecat' | 'apple_iap' | 'google_play' | 'manual_upi' | 'internal_wallet' | string;
export type TransactionStatus = 'initiated' | 'succeeded' | 'failed' | 'pending';

export interface Section194JTdsDetails {
  section: '194J';
  grossAmount: number;
  tdsRate: 0.10; // 10% TDS
  tdsAmount: number;
  netAmount: number;
  panNumber: string;
}

export interface WalletTransactionDoc {
  id: string;
  userId?: string;
  coachId?: string;
  type: TransactionType;
  amount: number;
  currency: 'INR' | 'USD';
  gateway?: PaymentGateway;
  gatewayOrderId?: string;
  gatewayPaymentId?: string;
  gatewaySignature?: string;
  status: TransactionStatus;
  creditsAdded?: number;
  creditsDeducted?: number;
  planId?: 'starter' | 'popular' | 'vip' | string;
  tdsDetails?: Section194JTdsDetails;
  utr?: string;
  vpa?: string;
  ledgerHash?: string;
  prevLedgerHash?: string;
  failureReason?: string;
  metadata?: Record<string, unknown>;
  createdAt: FirestoreDate;
  updatedAt?: FirestoreDate;
}

// =============================================================================
// 3b. PayoutRequestDoc (`payout_requests/{requestId}`)
// Manual UPI Settlement Queue
// =============================================================================
export type PayoutRequestStatus = 'PENDING_MANUAL_UPI' | 'PAID' | 'REJECTED';

export interface PayoutRequestDoc {
  id: string;
  coachId: string;
  coachAlias?: string;
  status: PayoutRequestStatus;
  coachUpiId: string;
  requestedPaise: number;
  tds194jPaise: number;
  netPayablePaise: number;
  netPayableInr: number;
  grossInr: number;
  panNumber?: string;
  utrNumber?: string;
  settledAt?: FirestoreDate;
  metadata?: Record<string, unknown>;
  createdAt: FirestoreDate;
  updatedAt: FirestoreDate;
}

// =============================================================================
// 4. ProspectCrmDoc (`prospects/{prospectId}`)
// =============================================================================
export type CrmStage = 'cold' | 'banter' | 'cooldown' | 'logistics' | 'debriefed' | string;
export type PlatformSource = 'Hinge' | 'Bumble' | 'Tinder' | 'In-person' | 'IG' | 'WhatsApp' | string;
export type TensionState = 'CHALLENGE' | 'INTEREST' | 'FRIENDLY' | 'UNRESPONSIVE' | string;

export interface ConversationSnippet {
  sender: 'her' | 'you' | 'coach';
  text: string;
  timestamp: string;
  subtextTag?: string;
}

export interface ProspectCrmDoc {
  id: string;
  userId: string;
  name: string;
  platform: PlatformSource;
  stage: CrmStage;
  tensionState: TensionState;
  matchedTime?: string;
  lastMessageSnippet?: string;
  notes?: string;
  recommendedMove?: string;
  cooldownEndsAt?: number;
  cooldownReason?: string;
  venueDetails?: {
    venue: string;
    dateTime: string;
    transitTime?: string;
    backupPlan?: string;
    seatingTactic?: string;
  };
  fieldReport?: {
    outcomeRating: number;
    physicalEscalation: string;
    nextMoveRecommendation: string;
    coachDebriefRequested: boolean;
    dateNotes?: string;
    redFlagsIdentified?: string[];
    loggedAt?: FirestoreDate;
  };
  history?: ConversationSnippet[];
  pastRedFlags?: string[];
  createdAt: FirestoreDate;
  updatedAt: FirestoreDate;
}

// =============================================================================
// 5. ScanDoc (`scans/{scanId}`)
// =============================================================================
export type IcfuCategory =
  | 'INTEREST'
  | 'CHALLENGE_TYPE_1'
  | 'CHALLENGE_TYPE_2'
  | 'FRIENDLY'
  | 'UNRESPONSIVE'
  | 'CHALLENGE';

export type ConversationStage = 1 | 2 | 3 | 4 | 5;
export type ScanInputMode = 'paste' | 'screenshot' | 'voice';

export interface YappingRatioWarning {
  warning: boolean;
  message: string;
}

export interface CalibratedMoveItem {
  framework: string;
  reply: string;
  whyItWorks: string;
  id?: number;
  yield?: string;
  why?: string;
}

export interface ScanDoc {
  id: string;
  scanId?: string;
  userId: string;
  prospectId?: string;
  inputMode: ScanInputMode;
  herMessage: string;
  userDraft?: string;
  region: string;
  dialect?: string;
  platform: string;
  icfuCategory: IcfuCategory;
  conversationStage: ConversationStage;
  interestScore: number; // 0 - 100
  yappingRatioWarning: YappingRatioWarning | boolean | string;
  draftCritique: string;
  calibratedMoves: CalibratedMoveItem[];
  matchingCardIds?: string[];
  card_ids?: string[];
  telemetry?: {
    interestScore: number;
    complianceTension: number;
    pacingRatio: string;
    cadence: string;
  };
  trapWarning?: {
    title: string;
    text: string;
  };
  critique?: {
    verdict: string;
    score: number | string;
    quote: string;
    analysis: string;
  };
  piiScrubbed?: boolean;
  rawGeminiResponse?: string;
  createdAt: FirestoreDate;
  updatedAt?: FirestoreDate;
}

// =============================================================================
// 6. DeckDoc (`decks/{deck_id}`)
// =============================================================================
export interface DeckPricing {
  tier_1_usd: number;
  tier_2a_aed: number;
  tier_2a_sar: number;
  tier_2b_usd: number;
  tier_3_inr: number;
  tier_3_pkr: number;
}

export interface DeckDoc {
  id: string;
  deck_id?: string;
  title: string;
  subtitle: string;
  iconColor: string;
  isPro: boolean;
  is_free_preview: boolean;
  cardCount: number;
  avgMastery?: number;
  pricing?: DeckPricing;
  createdAt?: FirestoreDate;
  updatedAt?: FirestoreDate;
}

// =============================================================================
// 7. CardDoc (`cards/{card_id}`)
// Matching seeds/cluetri_50_cards_seed.json
// =============================================================================
export interface CardDoc {
  id: string;
  card_id?: string;
  deckId: string;
  deck_id?: string;
  deckTitle: string;
  title: string;
  archetype: string;
  icfuTag: string;
  icfu_stage: string;
  is_free_preview: boolean;
  isPro?: boolean;
  badMove: string;
  goodMove: string;
  hinglish: string;
  bracketCustomizer: string;
  intervalDays: number;
  masteryLevel: number; // 0 - 100
  createdAt?: FirestoreDate;
  updatedAt?: FirestoreDate;
}

// =============================================================================
// 8. CoachDoc (`coaches/{coachId}`)
// =============================================================================
export type CoachKycStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

export interface CoachDoc {
  id: string; // Auth UID or partner ID
  coachId?: string;
  alias: string;
  realName?: string;
  avatarUrl?: string;
  bio?: string;
  rating: number; // e.g. 4.9
  reviewCount: number;
  isDutyOn: boolean;
  status?: 'ONLINE' | 'OFFLINE';
  withdrawablePaise: number; // CAN ONLY BE MUTATED BY ADMIN SDK CLOUD FUNCTIONS
  baseRatePerMinuteInr: number;
  internationalSurgeMultiplier?: number;
  surgeRatePerMinuteInr?: number;
  upiVpa: string;
  panNumber: string;
  kycStatus: CoachKycStatus;
  kyc?: {
    panVerified?: boolean;
    panNumber?: string;
    upiId?: string;
    vpa?: string;
    status?: string;
  };
  dialect?: string | string[];
  dialects?: string[];
  tier?: 'TIER_1' | 'TIER_2' | 'TIER_3' | string;
  tierLevel?: number;
  acousticAccreditationScore?: number;
  totalEarningsInr?: number;
  pendingPayoutInr?: number;
  totalWithdrawnInr?: number;
  lastHeartbeatAt?: FirestoreDate;
  createdAt: FirestoreDate;
  updatedAt: FirestoreDate;
}

// =============================================================================
// 9. LiveSessionDoc (`liveSessions/{sessionId}` / `warRoomSessions/{sessionId}`)
// =============================================================================
export type LiveSessionStatus =
  | 'ringing'
  | 'active'
  | 'completed'
  | 'cancelled'
  | 'timed_out'
  | 'RINGING'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'CANCELLED';

export interface TeleprompterMacroLog {
  timestamp: string;
  macroKey?: string; // '/1', '/2', '/3', '/4'
  text: string;
  sender: 'coach' | 'system' | 'client';
}

export interface LiveSessionDoc {
  id: string;
  sessionId?: string;
  userId?: string; // client Auth UID
  clientId?: string;
  clientAlias?: string;
  coachId?: string;
  coachAlias?: string;
  status: LiveSessionStatus;
  isInternationalSurge?: boolean;
  isGlobalSurge?: boolean;
  pppTier?: PppTier;
  lastPurchaseTier?: 'TIER_1' | 'TIER_2A' | 'TIER_2B' | 'TIER_3';
  paidSecondsRemaining?: number;
  surgeMultiplier?: number;
  ratePerMinuteInr?: number;
  bountyInr?: number;
  clientLocation?: string;
  clientPlatform?: string;
  targetName?: string;
  targetAge?: number;
  lastMessage?: string;
  behavioralTrap?: string;
  recommendedStrategy?: string;
  attachedScanId?: string;
  attachedScan?: {
    scanId?: string;
    blurredScreenshotUrl?: string;
    icfuState?: string;
    badDraft?: string;
    herMessage?: string;
  };
  trialBountyAwarded?: boolean;
  passedFromCoaches?: string[];
  ringingExpiresAt?: FirestoreDate;
  startedAt?: FirestoreDate;
  endedAt?: FirestoreDate;
  durationSeconds?: number;
  teleprompterLogs?: TeleprompterMacroLog[];
  totalChargeInr?: number;
  coachEarningsInr?: number;
  totalChargePaise?: number;
  coachEarningsPaise?: number;
  createdAt: FirestoreDate;
  updatedAt?: FirestoreDate;
}

// =============================================================================
// 10. PhotoAuditDoc (`photoAudits/{auditId}`)
// =============================================================================
export interface PhotoRankingItem {
  photoIndex: number;
  eloScore: number;
  critique: string;
  lightingRating: number;
  expressionRating: number;
}

export interface PhotoAuditDoc {
  id: string;
  userId?: string;
  photoUrls?: string[];
  overallEloScore?: number;
  rankings?: PhotoRankingItem[];
  recommendations?: string[];
  coachNotes?: string;
  reviewedByCoachId?: string;
  coachId?: string;
  status?: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | string;
  redFlagTags?: string[];
  promptRewrite?: string;
  voiceSummaryUrl?: string;
  voiceSummaryDurationSeconds?: number;
  completedAt?: FirestoreDate;
  createdAt: FirestoreDate;
  updatedAt?: FirestoreDate;
}

// =============================================================================
// VOICE NOTES COLLECTION SUPPORT (`voiceNotes/{voiceNoteId}`)
// =============================================================================
export type VoiceDrillScenarioId = 'venue-pivot' | 'post-date' | 'challenge-response' | 'freeform';
export type VoiceDrillMode = 'voicenote' | 'call';
export type VoicePacingRating = 'RUSHED' | 'OPTIMAL' | 'SLUGGISH';

export interface VoiceTonalityMetrics {
  wpmScore: number;
  pitchInflectionScore: number;
  warmthResonanceScore: number;
  vocalTremorScore: number;
  isDownwardInflection: boolean;
  pacingRating: VoicePacingRating;
  verbalFillersDetected: string[];
}

export interface VoiceFeedback {
  summary: string;
  strengths: string[];
  corrections: string[];
}

export interface VoiceNoteDocument {
  id: string;
  userId: string;
  drillScenarioId: VoiceDrillScenarioId;
  drillMode: VoiceDrillMode;
  durationSeconds: number;
  audioStoragePath?: string;
  audioUrl?: string;
  transcription?: string;
  metrics: VoiceTonalityMetrics;
  feedback: VoiceFeedback;
  createdAt: FirestoreDate;
}

// =============================================================================
// BACKWARD-COMPATIBLE TYPE ALIASES
// =============================================================================
export type UserDocument = UserDoc;
export type ProspectDocument = ProspectCrmDoc;
export type SituationDocument = ScanDoc;
export type DeckDocument = DeckDoc;
export type CardDocument = CardDoc;
export type CoachDocument = CoachDoc;
export type WarRoomSessionDocument = LiveSessionDoc;
export type TransactionDocument = WalletTransactionDoc;

export type SituationInputMode = ScanInputMode;
export type IcfuTelemetry = NonNullable<ScanDoc['telemetry']>;
export type TrapWarning = NonNullable<ScanDoc['trapWarning']>;
export type DraftCritique = NonNullable<ScanDoc['critique']>;
export type CalibratedMove = CalibratedMoveItem;
export type FlashcardDeckId = string;
export type FlashcardIcfuTag = string;
export type WarRoomSessionStatus = LiveSessionStatus;
