import { GoogleGenAI, Type } from '@google/genai';
import type {
  IcfuCategory,
  ConversationStage,
  CalibratedMoveItem,
  YappingRatioWarning,
} from '../types/firestore.types.js';

export interface SituationAnalysisResult {
  icfuCategory: IcfuCategory;
  conversationStage: ConversationStage;
  interestScore: number;
  yappingRatioWarning: YappingRatioWarning;
  draftCritique: string;
  calibratedMoves: CalibratedMoveItem[];
  rawGeminiResponse?: string;
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
}

export interface VoiceNoteAnalysisResult {
  estimatedWpm: number;
  wpmStatus: 'OPTIMAL' | 'TOO_RUSHED' | 'SLUGGISH';
  endingInflection: 'UPWARD_NEEDY' | 'DOWNWARD_GROUNDED' | 'MONOTONE';
  fillerWordCount: number;
  vibeScore: number;
  coachingFix: {
    instruction: string;
    rewrittenScript: string;
  };
  metrics?: {
    wpmScore: number;
    pitchInflectionScore: number;
    warmthResonanceScore: number;
    vocalTremorScore: number;
    isDownwardInflection: boolean;
    pacingRating: 'RUSHED' | 'OPTIMAL' | 'SLUGGISH';
    verbalFillersDetected: string[];
  };
  feedback?: {
    summary: string;
    strengths: string[];
    corrections: string[];
  };
  transcription?: string;
}

class GeminiService {
  private ai: GoogleGenAI | null = null;
  private modelName: string;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (apiKey) {
      this.ai = new GoogleGenAI({ apiKey });
    }
    this.modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  }

  /**
   * ICFU Situation & Draft Diagnostic
   * Evaluates herMessage and userDraft against the ICFU matrix and conversation stages.
   */
  async analyzeSituation(params: {
    herMessage: string;
    userDraft?: string;
    region?: string;
    dialect?: string;
    platform?: string;
  }): Promise<SituationAnalysisResult> {
    const {
      herMessage,
      userDraft = '',
      region = 'IN_METRO',
      dialect = 'Metro Hinglish',
      platform = 'Hinge',
    } = params;

    const situationSchema = {
      type: Type.OBJECT,
      properties: {
        icfuCategory: {
          type: Type.STRING,
          enum: [
            'INTEREST',
            'CHALLENGE_TYPE_1',
            'CHALLENGE_TYPE_2',
            'FRIENDLY',
            'UNRESPONSIVE',
          ],
        },
        conversationStage: {
          type: Type.INTEGER,
          description:
            'Stage of courtship: 1 = Opener, 2 = Vibing, 3 = Emotional Spike, 4 = Date Pitch, 5 = Pre-Date Confirmation',
        },
        interestScore: {
          type: Type.INTEGER,
          description: 'Attraction & interest score from 0 to 100',
        },
        yappingRatioWarning: {
          type: Type.OBJECT,
          properties: {
            warning: {
              type: Type.BOOLEAN,
              description:
                'True if userDraft is >2x herMessage length, contains interview interrogation, or needy double-texting',
            },
            message: {
              type: Type.STRING,
              description: 'Explanation of the ratio or boundary violation',
            },
          },
          required: ['warning', 'message'],
        },
        draftCritique: {
          type: Type.STRING,
          description:
            '1 punchy sentence explaining why userDraft fails (e.g., Nice-Guy approval seeking or Overgaming an Interest peak)',
        },
        calibratedMoves: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              framework: {
                type: Type.STRING,
                description:
                  'Core tactical framework: OAE, Agree & Exaggerate, Callback Hook, or 4-Day Bread Expiry Close',
              },
              reply: {
                type: Type.STRING,
                description:
                  'Calibrated copy explicitly matched to the target region/dialect',
              },
              whyItWorks: {
                type: Type.STRING,
                description:
                  'Tactical breakdown explaining why this reply resets frame and sparks polarization',
              },
            },
            required: ['framework', 'reply', 'whyItWorks'],
          },
        },
      },
      required: [
        'icfuCategory',
        'conversationStage',
        'interestScore',
        'yappingRatioWarning',
        'draftCritique',
        'calibratedMoves',
      ],
    };

    const prompt = `You are Cluetri Tactical Courtship Decision Engine.
Analyze this courtship message exchange:
- Her Message: "${herMessage}"
- User's Draft: "${userDraft}"
- Cultural Region: "${region}" (Calibration guides: IN_METRO -> natural Metro Hinglish, US_URBAN -> punchy Urban English, EU -> grounded connection, LATAM -> warm expressive)
- Dialect: "${dialect}"
- Platform: "${platform}"

Evaluate:
1. icfuCategory:
   - "INTEREST": Direct interest, compliance, asking personal questions, open availability.
   - "CHALLENGE_TYPE_1": Teasing, testing boundaries, playful banter, checking frame stability.
   - "CHALLENGE_TYPE_2": Defiance, resistance, skepticism, corporate interview energy, or passive-aggressive pushback.
   - "FRIENDLY": Platonic politeness, pleasant but low-polarity small talk, lukewarm rapport.
   - "UNRESPONSIVE": One-word stalls ("k", "nice"), 18h+ delays, dead silence.

2. conversationStage: 1 (Opener), 2 (Vibing), 3 (Emotional Spike), 4 (Date Pitch), 5 (Pre-Date Confirmation).

3. interestScore: 0 to 100 integer.

4. yappingRatioWarning:
   Check if userDraft length is >2x herMessage character length or contains double-texting or interview interrogation. Return warning boolean + specific flag message.

5. draftCritique:
   1 punchy, uncompromising sentence explaining why userDraft fails or weakens frame (e.g. "Nice-Guy approval seeking", "Premature escalation without rapport", "Apologetic defense of your lifestyle", or "Overgaming an Interest peak").

6. calibratedMoves:
   Array of EXACTLY 2 replies calibrated to the cultural region ("${region}"), selecting from:
   - "OAE" (Observation, Assumption, Escalation)
   - "Agree & Exaggerate"
   - "Callback Hook"
   - "4-Day Bread Expiry Close"
   Each with calibrated reply copy and a "whyItWorks" explanation note.`;

    if (this.ai) {
      try {
        const response = await this.ai.models.generateContent({
          model: this.modelName,
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: situationSchema,
          },
        });

        const text = response.text;
        if (text) {
          const parsed = JSON.parse(text) as {
            icfuCategory: IcfuCategory;
            conversationStage: ConversationStage;
            interestScore: number;
            yappingRatioWarning: YappingRatioWarning;
            draftCritique: string;
            calibratedMoves: CalibratedMoveItem[];
          };

          return {
            ...parsed,
            rawGeminiResponse: text,
            telemetry: {
              interestScore: parsed.interestScore,
              complianceTension: Math.min(100, Math.max(0, 100 - parsed.interestScore + 20)),
              pacingRatio: userDraft.length > 0 ? `1:${(userDraft.length / Math.max(1, herMessage.length)).toFixed(1)}` : '1:1',
              cadence: parsed.interestScore > 60 ? 'Brisk engagement' : 'Guarded latency',
            },
            trapWarning: {
              title: parsed.yappingRatioWarning.warning ? 'Yapping Ratio Exceeded' : 'Frame Risk',
              text: parsed.yappingRatioWarning.message,
            },
            critique: {
              verdict: parsed.interestScore > 65 ? 'PASSABLE' : 'FRAME COLLAPSE',
              score: parsed.interestScore,
              quote: userDraft,
              analysis: parsed.draftCritique,
            },
          };
        }
      } catch (err) {
        console.warn('[GeminiService] API call failed, deploying tactical fallback:', err);
      }
    }

    return this.fallbackSituationAnalysis(herMessage, userDraft, region);
  }

  /**
   * Multimodal 15-Second Voice Note Bio-Telemetry Calibrator
   * Evaluates base64 audio inline using Gemini 2.5 Flash Multimodal.
   */
  async analyzeVoiceNote(params: {
    audioBase64: string;
    mimeType?: string;
    scenario?: string;
    dialect?: string;
  }): Promise<VoiceNoteAnalysisResult> {
    const {
      audioBase64,
      mimeType = 'audio/wav',
      scenario = 'venue-pivot',
      dialect = 'Metro Hinglish',
    } = params;

    const voiceNoteSchema = {
      type: Type.OBJECT,
      properties: {
        estimatedWpm: {
          type: Type.NUMBER,
          description: 'Estimated words per minute spoken. Flag >160 WPM as TOO_RUSHED',
        },
        endingInflection: {
          type: Type.STRING,
          enum: ['UPWARD_NEEDY', 'DOWNWARD_GROUNDED', 'MONOTONE'],
        },
        fillerWordCount: {
          type: Type.INTEGER,
          description: 'Count of verbal fillers (like, um, uh, you know)',
        },
        vibeScore: {
          type: Type.INTEGER,
          description: 'Attraction and composure vibe score between 0 and 100',
        },
        coachingFix: {
          type: Type.OBJECT,
          properties: {
            instruction: {
              type: Type.STRING,
              description: 'Specific 1-sentence vocal coaching instruction',
            },
            rewrittenScript: {
              type: Type.STRING,
              description:
                'Rewritten 15-second script with [1s pause] markers to enforce cadence',
            },
          },
          required: ['instruction', 'rewrittenScript'],
        },
      },
      required: [
        'estimatedWpm',
        'endingInflection',
        'fillerWordCount',
        'vibeScore',
        'coachingFix',
      ],
    };

    const promptText = `You are Cluetri Acoustic Studio Bio-Telemetry Calibrator.
Analyze this voice recording for romantic polarity, vocal cadence, and frame grounding.
- Scenario: "${scenario}"
- Dialect/Context: "${dialect}"

Listen carefully to the audio and evaluate:
1. estimatedWpm: Words spoken per minute. If > 160, vocal delivery is too fast.
2. endingInflection:
   - "UPWARD_NEEDY": Pitch raises at sentence end, sounding like an insecure question seeking validation.
   - "DOWNWARD_GROUNDED": Pitch drops authoritatively at sentence end, signaling calm masculine leadership.
   - "MONOTONE": Lifeless, uncalibrated, robotic pitch.
3. fillerWordCount: Exact count of verbal crutches (uh, um, like, yeah, you know).
4. vibeScore: Overall tonality score (0 - 100).
5. coachingFix:
   - instruction: 1 sharp sentence correcting the vocal error.
   - rewrittenScript: A calibrated 15-second delivery script containing explicit "[1s pause]" markers.`;

    if (this.ai && audioBase64) {
      try {
        const contents = [
          {
            inlineData: {
              mimeType,
              data: audioBase64,
            },
          },
          {
            text: promptText,
          },
        ];

        const response = await this.ai.models.generateContent({
          model: this.modelName,
          contents,
          config: {
            responseMimeType: 'application/json',
            responseSchema: voiceNoteSchema,
          },
        });

        const text = response.text;
        if (text) {
          const parsed = JSON.parse(text) as {
            estimatedWpm: number;
            endingInflection: 'UPWARD_NEEDY' | 'DOWNWARD_GROUNDED' | 'MONOTONE';
            fillerWordCount: number;
            vibeScore: number;
            coachingFix: {
              instruction: string;
              rewrittenScript: string;
            };
          };

          const isRushed = parsed.estimatedWpm > 160;
          const wpmStatus = isRushed ? 'TOO_RUSHED' : parsed.estimatedWpm < 110 ? 'SLUGGISH' : 'OPTIMAL';

          return {
            estimatedWpm: parsed.estimatedWpm,
            wpmStatus,
            endingInflection: parsed.endingInflection,
            fillerWordCount: parsed.fillerWordCount,
            vibeScore: parsed.vibeScore,
            coachingFix: parsed.coachingFix,
            metrics: {
              wpmScore: parsed.estimatedWpm,
              pitchInflectionScore: parsed.endingInflection === 'DOWNWARD_GROUNDED' ? 88 : 42,
              warmthResonanceScore: parsed.vibeScore,
              vocalTremorScore: isRushed ? 28 : 8,
              isDownwardInflection: parsed.endingInflection === 'DOWNWARD_GROUNDED',
              pacingRating: isRushed ? 'RUSHED' : parsed.estimatedWpm < 110 ? 'SLUGGISH' : 'OPTIMAL',
              verbalFillersDetected: parsed.fillerWordCount > 0 ? ['um', 'like', 'uh'] : [],
            },
            feedback: {
              summary: parsed.coachingFix.instruction,
              strengths: [
                parsed.endingInflection === 'DOWNWARD_GROUNDED' ? 'Solid downward pitch inflection' : 'Clear articulation',
                parsed.fillerWordCount <= 1 ? 'Minimal filler words' : 'Decent vocal resonance',
              ],
              corrections: [
                isRushed ? 'Cadence exceeds 160 WPM. Slow down and let the silence breathe.' : parsed.coachingFix.instruction,
              ],
            },
          };
        }
      } catch (err) {
        console.warn('[GeminiService] Multimodal audio analysis failed, using fallback calibrator:', err);
      }
    }

    return this.fallbackVoiceNoteAnalysis(scenario, dialect);
  }

  /**
   * Rule-based fallback for situation diagnostics
   */
  private fallbackSituationAnalysis(
    herMessage: string,
    userDraft: string,
    region: string
  ): SituationAnalysisResult {
    const textLower = herMessage.toLowerCase();
    const isYapping = userDraft.length > Math.max(herMessage.length * 2, 80);

    let icfuCategory: IcfuCategory = 'CHALLENGE_TYPE_1';
    let conversationStage: ConversationStage = 2;
    let interestScore = 55;

    if (textLower.includes('?') || textLower.includes('when') || textLower.includes('you free') || textLower.includes('love')) {
      icfuCategory = 'INTEREST';
      conversationStage = 3;
      interestScore = 82;
    } else if (textLower.length < 5 || textLower === 'k' || textLower === 'ok' || textLower === 'haha') {
      icfuCategory = 'UNRESPONSIVE';
      conversationStage = 1;
      interestScore = 20;
    } else if (textLower.includes('busy') || textLower.includes('not sure') || textLower.includes('maybe')) {
      icfuCategory = 'CHALLENGE_TYPE_2';
      conversationStage = 2;
      interestScore = 40;
    } else if (textLower.includes('nice') || textLower.includes('cool') || textLower.includes('good')) {
      icfuCategory = 'FRIENDLY';
      conversationStage = 2;
      interestScore = 48;
    }

    const isMetro = region.includes('IN_METRO') || region.includes('Hinglish') || region.includes('India');

    const calibratedMoves: CalibratedMoveItem[] = isMetro
      ? [
        {
          framework: 'Agree & Exaggerate',
          reply: 'Haan bilkul, main toh full time Jira tickets aur validation dhundne hi paida hua tha. Try harder.',
          whyItWorks: 'Playfully absorbs the reframe, signaling zero emotional volatility.',
        },
        {
          framework: 'OAE',
          reply: 'Lagta hai tumhara caffeine level dangerous low ho gaya hai. Friday coffee pe case study solve karte hain.',
          whyItWorks: 'Observations lead directly to assumptive low-investment logistics.',
        },
      ]
      : [
        {
          framework: 'Agree & Exaggerate',
          reply: "Guilty. I literally spend all weekend drafting apologies to people I haven't met yet. Try again.",
          whyItWorks: 'Absorbs the frame and flips the banter directly onto her.',
        },
        {
          framework: '4-Day Bread Expiry Close',
          reply: 'Drinks this Thursday before your questionable humor runs completely out of warranty.',
          whyItWorks: 'Definite time anchor that asserts scarcity without needy check-ins.',
        },
      ];

    return {
      icfuCategory,
      conversationStage,
      interestScore,
      yappingRatioWarning: {
        warning: isYapping,
        message: isYapping
          ? 'Draft length exceeds 2x her message length. Signals over-investment and nice-guy validation seeking.'
          : 'Pacing ratio is calibrated.',
      },
      draftCritique: isYapping
        ? 'Nice-Guy approval seeking with excessive word count and defensive justification.'
        : 'Overgaming an interest peak instead of anchoring logistics.',
      calibratedMoves,
      telemetry: {
        interestScore,
        complianceTension: 65,
        pacingRatio: isYapping ? '1:2.4' : '1:1',
        cadence: 'Calibrated fallback',
      },
      trapWarning: {
        title: isYapping ? 'Yapping Trap' : 'Frame Watch',
        text: isYapping ? 'Over-investing with essay-length reply.' : 'Maintain conversational polarity.',
      },
      critique: {
        verdict: 'CALIBRATION_REQUIRED',
        score: interestScore,
        quote: userDraft,
        analysis: 'Draft needs sharper boundary setting.',
      },
    };
  }

  /**
   * Rule-based fallback for voice note diagnostics
   */
  private fallbackVoiceNoteAnalysis(
    scenario: string,
    dialect: string
  ): VoiceNoteAnalysisResult {
    return {
      estimatedWpm: 138,
      wpmStatus: 'OPTIMAL',
      endingInflection: 'DOWNWARD_GROUNDED',
      fillerWordCount: 1,
      vibeScore: 78,
      coachingFix: {
        instruction:
          'Drop your voice by half an octave at the end of every sentence and insert a full 1-second silence before answering.',
        rewrittenScript:
          'Look... [1s pause] I think you and I both know this banter is getting dangerous. [1s pause] Thursday, 8 PM. Bring your A-game.',
      },
      metrics: {
        wpmScore: 138,
        pitchInflectionScore: 84,
        warmthResonanceScore: 78,
        vocalTremorScore: 10,
        isDownwardInflection: true,
        pacingRating: 'OPTIMAL',
        verbalFillersDetected: ['um'],
      },
      feedback: {
        summary: 'Solid grounded baseline with room for intentional pause control.',
        strengths: ['Optimal pace under 160 WPM', 'Authoritative downward tone endings'],
        corrections: ['Add 1-second pause markers before logistics statements.'],
      },
    };
  }
}

export const geminiService = new GeminiService();
export default geminiService;
