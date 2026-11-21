/**
 * Store SKU & Tier Catalog
 * Cluetri 4-Tier Global App Store / Play Store Pricing & Entitlement Registry
 */

export type StoreTier = 'TIER_1' | 'TIER_2A' | 'TIER_2B' | 'TIER_3';

// -----------------------------------------------------------------------------
// Country to Tier Mappings
// -----------------------------------------------------------------------------
export const TIER_1_COUNTRIES: ReadonlyArray<string> = [
  'US', 'CA', 'GB', 'AU', 'NZ', 'DE', 'FR', 'NL', 'SE', 'NO', 'CH', 'IE', 'SG',
];

export const TIER_2A_COUNTRIES: ReadonlyArray<string> = [
  'AE', 'SA', 'QA', 'KW', 'BH', 'OM',
];

export const TIER_2B_COUNTRIES: ReadonlyArray<string> = [
  'BR', 'MX', 'CL', 'CO', 'PL', 'CZ', 'HU', 'RO', 'ZA', 'MY', 'TH',
];

export const TIER_3_COUNTRIES: ReadonlyArray<string> = [
  'IN', 'PK', 'PH', 'ID', 'VN', 'BD', 'LK', 'NP', 'NG', 'EG',
];

const TIER_1_SET = new Set(TIER_1_COUNTRIES);
const TIER_2A_SET = new Set(TIER_2A_COUNTRIES);
const TIER_2B_SET = new Set(TIER_2B_COUNTRIES);
const TIER_3_SET = new Set(TIER_3_COUNTRIES);

/**
 * Resolves StoreTier from ISO 2-letter Country Code.
 * Falls back to TIER_3 for unknown or unprovided country codes.
 */
export function getTierFromCountry(countryCode?: string | null): StoreTier {
  if (!countryCode) return 'TIER_3';
  const code = countryCode.trim().toUpperCase();
  if (TIER_1_SET.has(code)) return 'TIER_1';
  if (TIER_2A_SET.has(code)) return 'TIER_2A';
  if (TIER_2B_SET.has(code)) return 'TIER_2B';
  return 'TIER_3';
}

// -----------------------------------------------------------------------------
// Store SKU Types & Definitions
// -----------------------------------------------------------------------------
export type SkuType =
  | 'consumable'
  | 'non_consumable'
  | 'consumable_wallet'
  | 'subscription';

export interface TierPrice {
  amount: number;
  currency: string;
  formatted: string;
  secondary?: {
    amount: number;
    currency: string;
    formatted: string;
  };
}

export interface StoreSkuDefinition {
  sku: string;
  title: string;
  type: SkuType;
  entitlements: {
    scanTokens?: number;
    photoRoastTokens?: number;
    deckId?: string;
    standardSeconds?: number;
    firstTopUpSeconds?: number;
    standardUnits?: number; // legacy units
    firstTopUpUnits?: number; // legacy units
    subscriptionDays?: number;
  };
  pricing: {
    TIER_1: TierPrice;
    TIER_2A: TierPrice;
    TIER_2B: TierPrice;
    TIER_3: TierPrice;
  };
}

export const STORE_SKUS: Record<string, StoreSkuDefinition> = {
  // 1. Single Scan Token
  cluetri_single_scan: {
    sku: 'cluetri_single_scan',
    title: '+1 AI Scan Token',
    type: 'consumable',
    entitlements: {
      scanTokens: 1,
    },
    pricing: {
      TIER_1: { amount: 1.99, currency: 'USD', formatted: '$1.99' },
      TIER_2A: { amount: 5.99, currency: 'AED', formatted: '5.99 AED' },
      TIER_2B: { amount: 0.99, currency: 'USD', formatted: '$0.99' },
      TIER_3: {
        amount: 49,
        currency: 'INR',
        formatted: '₹49',
        secondary: { amount: 150, currency: 'PKR', formatted: 'Rs 150' },
      },
    },
  },

  // 2. Texting ICFU Deck
  deck_01_texting_icfu_a3: {
    sku: 'deck_01_texting_icfu_a3',
    title: 'Texting ICFU Tactical Drill Pack',
    type: 'non_consumable',
    entitlements: {
      deckId: 'deck_01_texting_icfu_a3',
    },
    pricing: {
      TIER_1: { amount: 6.99, currency: 'USD', formatted: '$6.99' },
      TIER_2A: {
        amount: 17.99,
        currency: 'AED',
        formatted: '17.99 AED',
        secondary: { amount: 17.99, currency: 'SAR', formatted: '17.99 SAR' },
      },
      TIER_2B: { amount: 3.49, currency: 'USD', formatted: '$3.49' },
      TIER_3: {
        amount: 199,
        currency: 'INR',
        formatted: '₹199',
        secondary: { amount: 650, currency: 'PKR', formatted: 'Rs 650' },
      },
    },
  },

  // 3. IRL Date Mastery Deck
  deck_02_irl_oae_date_mastery: {
    sku: 'deck_02_irl_oae_date_mastery',
    title: 'IRL OAE Date Mastery & Logistics Pack',
    type: 'non_consumable',
    entitlements: {
      deckId: 'deck_02_irl_oae_date_mastery',
    },
    pricing: {
      TIER_1: { amount: 6.99, currency: 'USD', formatted: '$6.99' },
      TIER_2A: {
        amount: 17.99,
        currency: 'AED',
        formatted: '17.99 AED',
        secondary: { amount: 17.99, currency: 'SAR', formatted: '17.99 SAR' },
      },
      TIER_2B: { amount: 3.49, currency: 'USD', formatted: '$3.49' },
      TIER_3: {
        amount: 199,
        currency: 'INR',
        formatted: '₹199',
        secondary: { amount: 650, currency: 'PKR', formatted: 'Rs 650' },
      },
    },
  },

  // 4. Async Photo Roast Token
  cluetri_photo_roast_async: {
    sku: 'cluetri_photo_roast_async',
    title: '+1 Human 5-Photo Roast Token',
    type: 'consumable',
    entitlements: {
      photoRoastTokens: 1,
    },
    pricing: {
      TIER_1: { amount: 14.99, currency: 'USD', formatted: '$14.99' },
      TIER_2A: { amount: 36.99, currency: 'AED', formatted: '36.99 AED' },
      TIER_2B: { amount: 6.99, currency: 'USD', formatted: '$6.99' },
      TIER_3: {
        amount: 199,
        currency: 'INR',
        formatted: '₹199',
        secondary: { amount: 650, currency: 'PKR', formatted: 'Rs 650' },
      },
    },
  },

  // 5. Starter Wallet Top-Up
  cluetri_wallet_starter: {
    sku: 'cluetri_wallet_starter',
    title: 'Cluetri 15-Min Coach Pack (5-7 Live Mins)',
    type: 'consumable_wallet',
    entitlements: {
      standardSeconds: 300, // 5 mins
      firstTopUpSeconds: 420, // 7 mins
      standardUnits: 10000,
      firstTopUpUnits: 14000,
    },
    pricing: {
      TIER_1: { amount: 6.99, currency: 'USD', formatted: '$6.99' },
      TIER_2A: { amount: 17.99, currency: 'AED', formatted: '17.99 AED' },
      TIER_2B: { amount: 3.99, currency: 'USD', formatted: '$3.99' },
      TIER_3: {
        amount: 149,
        currency: 'INR',
        formatted: '₹149',
        secondary: { amount: 490, currency: 'PKR', formatted: 'Rs 490' },
      },
    },
  },

  // 6. Popular Wallet Top-Up
  cluetri_wallet_popular: {
    sku: 'cluetri_wallet_popular',
    title: 'Cluetri 45-Min Coach Pack (12-15 Live Mins)',
    type: 'consumable_wallet',
    entitlements: {
      standardSeconds: 720, // 12 mins
      firstTopUpSeconds: 900, // 15 mins
      standardUnits: 20000,
      firstTopUpUnits: 28000,
    },
    pricing: {
      TIER_1: { amount: 14.99, currency: 'USD', formatted: '$14.99' },
      TIER_2A: { amount: 36.99, currency: 'AED', formatted: '36.99 AED' },
      TIER_2B: { amount: 7.99, currency: 'USD', formatted: '$7.99' },
      TIER_3: {
        amount: 299,
        currency: 'INR',
        formatted: '₹299',
        secondary: { amount: 990, currency: 'PKR', formatted: 'Rs 990' },
      },
    },
  },

  // 7. Pro Wallet Top-Up
  cluetri_wallet_pro: {
    sku: 'cluetri_wallet_pro',
    title: 'Cluetri 120-Min Coach Pack (30-38 Live Mins) + Photo Roast',
    type: 'consumable_wallet',
    entitlements: {
      standardSeconds: 1800, // 30 mins
      firstTopUpSeconds: 2280, // 38 mins
      standardUnits: 50000,
      firstTopUpUnits: 70000,
      photoRoastTokens: 1,
    },
    pricing: {
      TIER_1: { amount: 34.99, currency: 'USD', formatted: '$34.99' },
      TIER_2A: { amount: 89.99, currency: 'AED', formatted: '89.99 AED' },
      TIER_2B: { amount: 19.99, currency: 'USD', formatted: '$19.99' },
      TIER_3: {
        amount: 699,
        currency: 'INR',
        formatted: '₹699',
        secondary: { amount: 2290, currency: 'PKR', formatted: 'Rs 2,290' },
      },
    },
  },

  // 8. Cluetri Pro Monthly
  cluetri_pro_monthly: {
    sku: 'cluetri_pro_monthly',
    title: 'Cluetri Pro Monthly (30 Days)',
    type: 'subscription',
    entitlements: {
      subscriptionDays: 30,
    },
    pricing: {
      TIER_1: { amount: 12.99, currency: 'USD', formatted: '$12.99' },
      TIER_2A: { amount: 32.99, currency: 'AED', formatted: '32.99 AED' },
      TIER_2B: { amount: 5.99, currency: 'USD', formatted: '$5.99' },
      TIER_3: {
        amount: 399,
        currency: 'INR',
        formatted: '₹399',
        secondary: { amount: 1290, currency: 'PKR', formatted: 'Rs 1,290' },
      },
    },
  },

  // 9. Cluetri Pro Quarterly
  cluetri_pro_quarterly: {
    sku: 'cluetri_pro_quarterly',
    title: 'Cluetri Pro Quarterly (90 Days)',
    type: 'subscription',
    entitlements: {
      subscriptionDays: 90,
    },
    pricing: {
      TIER_1: { amount: 29.99, currency: 'USD', formatted: '$29.99' },
      TIER_2A: { amount: 74.99, currency: 'AED', formatted: '74.99 AED' },
      TIER_2B: { amount: 12.99, currency: 'USD', formatted: '$12.99' },
      TIER_3: {
        amount: 899,
        currency: 'INR',
        formatted: '₹899',
        secondary: { amount: 2900, currency: 'PKR', formatted: 'Rs 2,900' },
      },
    },
  },

  // 10. Cluetri Pro Yearly
  cluetri_pro_yearly: {
    sku: 'cluetri_pro_yearly',
    title: 'Cluetri Pro Yearly (365 Days)',
    type: 'subscription',
    entitlements: {
      subscriptionDays: 365,
    },
    pricing: {
      TIER_1: { amount: 59.99, currency: 'USD', formatted: '$59.99' },
      TIER_2A: { amount: 149.99, currency: 'AED', formatted: '149.99 AED' },
      TIER_2B: { amount: 24.99, currency: 'USD', formatted: '$24.99' },
      TIER_3: {
        amount: 2499,
        currency: 'INR',
        formatted: '₹2,499',
        secondary: { amount: 7900, currency: 'PKR', formatted: 'Rs 7,900' },
      },
    },
  },
};

/**
 * Retrieve SKU definition by identifier
 */
export function getSkuDefinition(sku: string): StoreSkuDefinition | undefined {
  return STORE_SKUS[sku];
}

/**
 * Calculate coach minute payout rate in paise based on client's purchase tier and coach tier level.
 *
 * Rules:
 * - TIER_3 (India/Pakistan/SEA):
 *     Tier 2 Coach: ₹13.00/min (1300 paise)
 *     Tier 3 Coach: ₹18.00/min (1800 paise)
 * - TIER_2A & TIER_2B (Middle East / LATAM / E. Europe):
 *     All Coaches: ₹18.00/min (1800 paise — 1.35x Regional Surge)
 * - TIER_1 (US / Canada / UK / Aus / EU):
 *     All Coaches: ₹22.50/min (2250 paise — 1.5x Global Arbitrage Surge)
 */
export function getCoachRatePaise(
  clientTier: StoreTier,
  coachTier: string | number = 'TIER_2'
): number {
  if (clientTier === 'TIER_1') {
    return 2250; // ₹22.50 / min (1.5x Global Arbitrage Surge)
  }
  if (clientTier === 'TIER_2A' || clientTier === 'TIER_2B') {
    return 1800; // ₹18.00 / min (1.35x Regional Surge)
  }
  // TIER_3: Domestic / South Asia
  const isTier3Coach =
    coachTier === 'TIER_3' || coachTier === 3 || coachTier === '3';
  return isTier3Coach ? 1800 : 1300; // ₹18.00 / min or ₹13.00 / min
}
