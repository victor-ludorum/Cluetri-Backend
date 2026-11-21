# Cluetri Backend (`cluetri-backend`)

Tactical courtship decision engine and cognitive performance backend services for **Cluetri** (`SYS-FIELDREAD-PRO-2025`).

---

## 🛠 Tech Stack

- **Runtime**: Node.js 22 (ESM)
- **Framework**: Firebase Cloud Functions v2 / Google Cloud Functions Framework
- **Language**: TypeScript 5.8+
- **Database**: Cloud Firestore (Zero-Trust Security Rules & Indexes)
- **AI Engine**: Google Gemini API via `@google/genai`
- **Monetization & Billing**: RevenueCat Webhooks, Razorpay, Stripe, Section 194J 10% TDS with UPI Payouts
- **Testing**: Node.js native test runner with `tsx`

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Local Development Server
```bash
npm run dev
```

### 3. Run Backend Test Suite
```bash
npm test
```

### 4. Build TypeScript
```bash
npm run build
```

---

## 🔄 CI/CD & Automated Deployment

This repository includes automated GitHub Actions workflows located in `.github/workflows/deploy-functions.yml`. On every push to `main` or `master`:
1. Dependencies are cleanly installed (`npm ci`).
2. TypeScript code is compiled (`npm run build`).
3. Unit and integration tests are executed (`npm test`).
4. Functions and Firestore security rules/indexes are automatically deployed to Firebase project `cluetri`.

### Required GitHub Secrets
In your GitHub repository settings under **Settings > Secrets and variables > Actions**, add either:
- `FIREBASE_SERVICE_ACCOUNT_CLUETRI`: Service account private key JSON for the `cluetri` project (Recommended).
- OR `FIREBASE_TOKEN`: CI authentication token from `firebase login:ci`.
