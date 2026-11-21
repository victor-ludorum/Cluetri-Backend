import type { Request, Response } from '@google-cloud/functions-framework';
import { z } from 'zod';
import { db, bucket } from '../config/firebaseAdmin.js';
import { COLLECTIONS } from '../types/firestore.types.js';
import type { VoiceNoteDocument, VoiceDrillScenarioId, VoiceDrillMode } from '../types/firestore.types.js';
import { geminiService } from '../services/geminiService.js';
import { verifyOptionalFirebaseAuth, FirebaseAuthError } from '../middleware/verifyAuth.js';

const AnalyzeVoiceNoteSchema = z.object({
  audioBase64: z.string().min(1, 'audioBase64 is required'),
  mimeType: z.string().optional().default('audio/wav'),
  scenario: z.string().optional().default('venue-pivot'),
  dialect: z.string().optional().default('Metro Hinglish'),
  userId: z.string().optional().default('anon-customer'),
});

export async function analyzeVoiceNoteHandler(req: Request, res: Response): Promise<void> {
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

    const parseResult = AnalyzeVoiceNoteSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Invalid request body',
        details: parseResult.error.flatten(),
      });
      return;
    }

    const { audioBase64, mimeType, scenario, dialect, userId: bodyUserId } = parseResult.data;
    const userId = verifiedUser?.uid || bodyUserId;

    let audioStoragePath: string | undefined;
    let audioUrl: string | undefined;

    // Optional upload to Cloud Storage bucket if configured
    if (audioBase64 && bucket) {
      try {
        const audioBuffer = Buffer.from(audioBase64, 'base64');
        const filename = `voice-drills/${userId}/${Date.now()}_${scenario}.wav`;
        const file = bucket.file(filename);

        await file.save(audioBuffer, {
          contentType: mimeType,
          metadata: {
            scenario,
            dialect,
            userId,
          },
        });

        audioStoragePath = filename;
        audioUrl = `https://storage.googleapis.com/${bucket.name}/${filename}`;
      } catch (storageErr) {
        console.warn('[analyzeVoiceNote] Cloud Storage bypass:', storageErr);
      }
    }

    // 1. Pass audio inline to Gemini 2.5 Flash Multimodal
    const analysis = await geminiService.analyzeVoiceNote({
      audioBase64,
      mimeType,
      scenario,
      dialect,
    });

    // 2. Persist record in Firestore
    const docRef = db.collection(COLLECTIONS.VOICE_NOTES).doc();
    const voiceNoteRecord: VoiceNoteDocument = {
      id: docRef.id,
      userId,
      drillScenarioId: (scenario as VoiceDrillScenarioId) || 'venue-pivot',
      drillMode: 'voicenote' as VoiceDrillMode,
      durationSeconds: Math.round((analysis.estimatedWpm / 60) * 15) || 15,
      audioStoragePath,
      audioUrl,
      transcription: analysis.transcription,
      metrics: analysis.metrics || {
        wpmScore: analysis.estimatedWpm,
        pitchInflectionScore: analysis.endingInflection === 'DOWNWARD_GROUNDED' ? 88 : 40,
        warmthResonanceScore: analysis.vibeScore,
        vocalTremorScore: analysis.wpmStatus === 'TOO_RUSHED' ? 25 : 8,
        isDownwardInflection: analysis.endingInflection === 'DOWNWARD_GROUNDED',
        pacingRating: analysis.wpmStatus === 'TOO_RUSHED' ? 'RUSHED' : analysis.wpmStatus,
        verbalFillersDetected: [],
      },
      feedback: analysis.feedback || {
        summary: analysis.coachingFix.instruction,
        strengths: [analysis.endingInflection === 'DOWNWARD_GROUNDED' ? 'Downward grounded inflection' : 'Decent pitch'],
        corrections: [analysis.coachingFix.instruction],
      },
      createdAt: new Date(),
    };

    await docRef.set(voiceNoteRecord).catch((err: unknown) => {
      console.warn('[analyzeVoiceNote] Record save warning:', err);
    });

    // 3. Return structured payload
    res.status(200).json({
      success: true,
      voiceNoteId: docRef.id,
      evaluation: {
        estimatedWpm: analysis.estimatedWpm,
        wpmStatus: analysis.wpmStatus,
        endingInflection: analysis.endingInflection,
        fillerWordCount: analysis.fillerWordCount,
        vibeScore: analysis.vibeScore,
        coachingFix: analysis.coachingFix,
      },
      record: voiceNoteRecord,
    });
  } catch (error) {
    console.error('[analyzeVoiceNote] Handler Error:', error);
    res.status(500).json({
      error: 'Failed to analyze voice note',
      message: error instanceof Error ? error.message : 'Unknown internal error',
    });
  }
}
