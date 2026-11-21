import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, app } from '../src/config/firebaseAdmin.js';
import { COLLECTIONS } from '../src/types/firestore.types.js';
import { geminiService } from '../src/services/geminiService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('1. Firebase Admin and Firestore config', () => {
  assert.ok(app, 'Firebase app should be initialized');
  assert.ok(db, 'Firestore instance db should be exported');
});

test('2. Firestore Collections and Types structure', () => {
  assert.equal(COLLECTIONS.USERS, 'users');
  assert.equal(COLLECTIONS.WALLETS, 'wallets');
  assert.equal(COLLECTIONS.PROSPECTS, 'prospects');
  assert.equal(COLLECTIONS.SCANS, 'scans');
  assert.equal(COLLECTIONS.DECKS, 'decks');
  assert.equal(COLLECTIONS.CARDS, 'cards');
  assert.equal(COLLECTIONS.COACHES, 'coaches');
  assert.ok(COLLECTIONS.LIVE_SESSIONS === 'live_sessions' || COLLECTIONS.LIVE_SESSIONS === 'liveSessions');
  assert.ok(COLLECTIONS.PHOTO_AUDITS === 'photo_audits' || COLLECTIONS.PHOTO_AUDITS === 'photoAudits');
});

test('3. Seed file structure matches 5 decks and 50 cards', () => {
  const seedPath = path.resolve(__dirname, '../seeds/cluetri_50_cards_seed.json');
  assert.ok(fs.existsSync(seedPath), 'Seed file must exist');

  const raw = fs.readFileSync(seedPath, 'utf-8');
  const seed = JSON.parse(raw);

  assert.equal(seed.decks.length, 5, 'Must have exactly 5 decks');
  assert.equal(seed.cards.length, 50, 'Must have exactly 50 cards');

  // Verify sample deck
  const deck1 = seed.decks[0];
  assert.ok(deck1.id);
  assert.ok(deck1.title);
  assert.equal(typeof deck1.isPro, 'boolean');

  // Verify sample card
  const card1 = seed.cards[0];
  assert.ok(card1.id);
  assert.ok(card1.deckId);
  assert.ok(card1.title);
  assert.ok(card1.archetype);
  assert.ok(card1.icfuTag);
  assert.ok(card1.badMove);
  assert.ok(card1.goodMove);
  assert.ok(card1.hinglish);
});

test('4. Firestore Rules validation and policy checks', () => {
  const rulesPath = path.resolve(__dirname, '../firestore.rules');
  assert.ok(fs.existsSync(rulesPath), 'firestore.rules must exist');

  const rulesContent = fs.readFileSync(rulesPath, 'utf-8');
  assert.ok(rulesContent.includes("rules_version = '2';"), 'Rules must use rules_version 2');

  // Verify wallets/{uid} write forbidden
  assert.ok(rulesContent.includes('match /wallets/{uid}'), 'Must protect wallets/{uid}');
  assert.ok(rulesContent.includes('allow write: if false;'), 'Wallets must be client read-only');

  // Verify coaches/{coachId}.withdrawablePaise mutation restriction
  assert.ok(rulesContent.includes('match /coaches/{coachId}'), 'Must secure coaches/{coachId}');
  assert.ok(rulesContent.includes('withdrawablePaise'), 'Must restrict withdrawablePaise');

  // Verify decks and cards authorization logic
  assert.ok(rulesContent.includes('match /decks/{deckId}'), 'Must cover decks');
  assert.ok(rulesContent.includes('match /cards/{cardId}'), 'Must cover cards');
  assert.ok(rulesContent.includes('is_free_preview'), 'Must support is_free_preview');
  assert.ok(rulesContent.includes('unlockedDecks'), 'Must check user.unlockedDecks');
  assert.ok(rulesContent.includes('isPro'), 'Must check user.isPro');

  // Verify prospects and scans ownership rules
  assert.ok(rulesContent.includes('match /prospects/{prospectId}'), 'Must protect prospects');
  assert.ok(rulesContent.includes('match /scans/{scanId}'), 'Must protect scans');
});

test('5. Gemini AI Service analyzeSituation diagnostic', async () => {
  const result = await geminiService.analyzeSituation({
    herMessage: 'Are you always this sarcastic with girls on Hinge?',
    userDraft: 'Haha no sorry if that sounded mean! I was just teasing you because I think you are really cute and I wanted to see how you would react.',
    region: 'IN_METRO',
    dialect: 'Metro Hinglish',
    platform: 'Hinge',
  });

  assert.ok(
    [
      'INTEREST',
      'CHALLENGE_TYPE_1',
      'CHALLENGE_TYPE_2',
      'FRIENDLY',
      'UNRESPONSIVE',
    ].includes(result.icfuCategory),
    `Invalid icfuCategory: ${result.icfuCategory}`
  );

  assert.ok(result.conversationStage >= 1 && result.conversationStage <= 5, 'Invalid conversation stage');
  assert.ok(result.interestScore >= 0 && result.interestScore <= 100, 'Invalid interest score');
  assert.equal(typeof result.yappingRatioWarning.warning, 'boolean');
  assert.equal(typeof result.draftCritique, 'string');
  assert.ok(result.calibratedMoves.length >= 2, 'Should provide at least 2 calibrated moves');

  for (const move of result.calibratedMoves) {
    assert.ok(move.framework, 'Move must specify framework');
    assert.ok(move.reply, 'Move must specify reply');
    assert.ok(move.whyItWorks, 'Move must include whyItWorks');
  }
});

test('6. Gemini AI Service analyzeVoiceNote tonality evaluation', async () => {
  const mockAudioBase64 = Buffer.from('RIFF....WAVEfmt ').toString('base64');
  const result = await geminiService.analyzeVoiceNote({
    audioBase64: mockAudioBase64,
    mimeType: 'audio/wav',
    scenario: 'venue-pivot',
    dialect: 'Metro Hinglish',
  });

  assert.equal(typeof result.estimatedWpm, 'number');
  assert.ok(['OPTIMAL', 'TOO_RUSHED', 'SLUGGISH'].includes(result.wpmStatus));
  assert.ok(['UPWARD_NEEDY', 'DOWNWARD_GROUNDED', 'MONOTONE'].includes(result.endingInflection));
  assert.equal(typeof result.fillerWordCount, 'number');
  assert.ok(result.vibeScore >= 0 && result.vibeScore <= 100);
  assert.ok(result.coachingFix.instruction, 'Instruction must be provided');
  assert.ok(result.coachingFix.rewrittenScript.includes('[1s pause]'), 'Script must include [1s pause] markers');
});
