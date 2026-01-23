import { Router, Request, Response } from 'express';
import twilio from 'twilio';
import { pool, getSetting } from '../lib/db.js';
import { registerRetellCall } from '../services/retell.js';
import { sendConfirmationSms } from '../services/twilio.js';

export const voiceRouter = Router();

const VoiceResponse = twilio.twiml.VoiceResponse;

interface NotificationSettings {
  enabled: boolean;
  contacts: Array<{ name: string; phone: string; email: string }>;
  channels: { email: boolean; sms: boolean };
}

interface VoicemailGreeting {
  message: string;
  voice: string;
}

/**
 * POST /voice/incoming
 * Twilio webhook for incoming calls
 */
voiceRouter.post('/incoming', async (req: Request, res: Response) => {
  const { CallSid, From, To, CallerCity, CallerState, CallerCountry } = req.body;

  console.log('Incoming call:', { CallSid, From, To });

  try {
    // Determine routing (for now, always route to Retell since 24/7)
    const destination = 'retell_agent';

    // Log the call to database
    await pool.query(`
      INSERT INTO calls (twilio_sid, direction, status, from_number, to_number, started_at, routed_to, caller_city, caller_state, caller_country)
      VALUES ($1, 'inbound', 'ringing', $2, $3, NOW(), $4, $5, $6, $7)
    `, [CallSid, From, To, destination, CallerCity, CallerState, CallerCountry]);

    const twiml = new VoiceResponse();

    if (destination === 'retell_agent') {
      // Register call with Retell and get SIP URI
      const retellResult = await registerRetellCall(From, To);

      if (retellResult.success && retellResult.sipUri) {
        // Dial Retell agent via SIP
        const dial = twiml.dial();
        dial.sip(retellResult.sipUri);
      } else {
        // Fallback to voicemail if Retell fails
        console.error('Retell registration failed, falling back to voicemail');
        await generateVoicemailTwiml(twiml);
      }
    } else {
      // Voicemail
      await generateVoicemailTwiml(twiml);
    }

    res.type('text/xml');
    res.send(twiml.toString());
  } catch (error) {
    console.error('Error handling incoming call:', error);

    // Return basic voicemail on error
    const twiml = new VoiceResponse();
    twiml.say({ voice: 'alice' }, 'We are experiencing technical difficulties. Please try again later.');
    twiml.hangup();

    res.type('text/xml');
    res.send(twiml.toString());
  }
});

/**
 * POST /voice/status
 * Twilio webhook for call status updates
 */
voiceRouter.post('/status', async (req: Request, res: Response) => {
  const { CallSid, CallStatus, CallDuration, Timestamp } = req.body;

  console.log('Call status update:', { CallSid, CallStatus, CallDuration });

  try {
    await pool.query(`
      UPDATE calls SET
        status = $1,
        duration = $2,
        ended_at = CASE WHEN $1 = 'completed' THEN $3::timestamptz ELSE ended_at END
      WHERE twilio_sid = $4
    `, [CallStatus, parseInt(CallDuration) || null, Timestamp ? new Date(Timestamp) : null, CallSid]);

    res.sendStatus(200);
  } catch (error) {
    console.error('Error updating call status:', error);
    res.sendStatus(500);
  }
});

/**
 * POST /voice/recording
 * Twilio webhook when recording is complete
 */
voiceRouter.post('/recording', async (req: Request, res: Response) => {
  const { CallSid, RecordingSid, RecordingUrl, RecordingDuration } = req.body;

  console.log('Recording complete:', { CallSid, RecordingSid, RecordingDuration });

  try {
    const audioUrl = RecordingUrl + '.mp3';

    // Update call with recording info and get call ID
    const { rows } = await pool.query(`
      UPDATE calls SET recording_sid = $1, recording_url = $2
      WHERE twilio_sid = $3
      RETURNING id
    `, [RecordingSid, audioUrl, CallSid]);

    // Create voicemail entry
    if (rows[0]) {
      await pool.query(`
        INSERT INTO voicemails (call_id, audio_url, duration, transcription_status)
        VALUES ($1, $2, $3, 'pending')
      `, [rows[0].id, audioUrl, parseInt(RecordingDuration) || 0]);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Error saving recording:', error);
    res.sendStatus(500);
  }
});

/**
 * POST /voice/transcription
 * Twilio webhook when transcription is complete
 */
voiceRouter.post('/transcription', async (req: Request, res: Response) => {
  const { CallSid, TranscriptionText, TranscriptionStatus } = req.body;

  console.log('Transcription complete:', { CallSid, TranscriptionStatus });

  try {
    const status = TranscriptionStatus === 'completed' ? 'completed' : 'failed';

    // Update voicemail with transcript and get call info
    const { rows } = await pool.query(`
      UPDATE voicemails v SET
        transcript = $1,
        transcription_status = $2
      FROM calls c
      WHERE v.call_id = c.id AND c.twilio_sid = $3
      RETURNING v.id, c.from_number, c.started_at, v.duration, v.audio_url
    `, [TranscriptionText, status, CallSid]);

    // Send SMS notification if transcription succeeded
    if (rows[0] && status === 'completed') {
      await sendVoicemailNotification(rows[0], TranscriptionText);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Error saving transcription:', error);
    res.sendStatus(500);
  }
});

/**
 * Generate voicemail TwiML
 */
async function generateVoicemailTwiml(twiml: twilio.twiml.VoiceResponse): Promise<void> {
  const greeting = await getSetting<VoicemailGreeting>('voicemail_greeting');
  const message = greeting?.message || 'Please leave a message after the tone.';
  const voice = greeting?.voice || 'alice';

  twiml.say({ voice: voice as any }, message);
  twiml.record({
    maxLength: 120,
    transcribe: true,
    transcribeCallback: '/voice/transcription',
    recordingStatusCallback: '/voice/recording',
    recordingStatusCallbackEvent: ['completed'],
  });
  twiml.say({ voice: voice as any }, 'Thank you for your message. Goodbye.');
}

/**
 * Send SMS notification for new voicemail
 */
async function sendVoicemailNotification(
  voicemail: { id: string; from_number: string; started_at: Date; duration: number },
  transcript: string
): Promise<void> {
  const settings = await getSetting<NotificationSettings>('notifications');

  if (!settings?.enabled || !settings.channels.sms) {
    console.log('SMS notifications disabled');
    return;
  }

  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  if (!messagingServiceSid) {
    console.warn('TWILIO_MESSAGING_SERVICE_SID not set, skipping notification');
    return;
  }

  const fromNumber = formatPhone(voicemail.from_number);
  const truncatedTranscript = transcript.length > 100
    ? transcript.substring(0, 100) + '...'
    : transcript;

  const message = `New voicemail from ${fromNumber}:\n"${truncatedTranscript}"`;

  for (const contact of settings.contacts) {
    if (contact.phone) {
      try {
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        await client.messages.create({
          to: contact.phone,
          messagingServiceSid,
          body: message,
        });
        console.log(`SMS notification sent to ${contact.name}`);
      } catch (error) {
        console.error(`Failed to send SMS to ${contact.name}:`, error);
      }
    }
  }
}

/**
 * Format phone number for display
 */
function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return phone;
}
