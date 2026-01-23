# Dominium CRM - Voice & Call Management Specification

## Overview

Expand the SMS Consent Portal into a simple CRM with voice call handling, voicemail management, and an admin dashboard.

### Goals

1. **Inbound Call Routing** - Time-based routing (Retell agent vs voicemail)
2. **Voicemail Storage** - Record, transcribe, and store voicemails
3. **Call Logging** - Track all inbound/outbound calls
4. **Admin Dashboard** - Web UI for viewing calls, voicemails, and configuration
5. **Google OAuth** - Secure access restricted to Dominium workspace

---

## Confirmed Configuration

| Setting | Value |
|---------|-------|
| Google Workspace Domain | `dominium.ca` |
| Timezone | `America/Edmonton` (Mountain Time - Calgary) |
| Business Hours | 24/7 (for now) |
| Voicemail Notifications | SMS + Email to specified contact |
| Retell SIP Server | `sip.retellai.com` |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              INBOUND CALL FLOW                               │
└─────────────────────────────────────────────────────────────────────────────┘

  Caller                Twilio              Dominium Server           Retell API
    │                     │                       │                       │
    │──── Inbound Call ──▶│                       │                       │
    │                     │── POST /voice/incoming─▶│                       │
    │                     │                       │                       │
    │                     │                   Check time &                │
    │                     │                   routing rules               │
    │                     │                       │                       │
    │                     │               [If Business Hours]             │
    │                     │                       │                       │
    │                     │                       │── Register Call ─────▶│
    │                     │                       │   (POST /register)    │
    │                     │                       │                       │
    │                     │                       │◀── { call_id } ───────│
    │                     │                       │                       │
    │                     │◀── TwiML: <Dial><Sip> │                       │
    │                     │    sip:{call_id}@     │                       │
    │                     │    sip.retellai.com   │                       │
    │                     │                       │                       │
    │◀═══════════════════ SIP Connection ═════════════════════════════════▶│
    │                     │                       │                       │
    │                     │               [If After Hours]                │
    │                     │                       │                       │
    │                     │◀── TwiML: <Say>       │                       │
    │                     │          <Record>     │                       │
    │                     │                       │                       │
    │◀── Voicemail ───────│                       │                       │
    │                     │                       │                       │
    │                     │── POST /voice/recording                       │
    │                     │                       │                       │
    │                     │── POST /voice/transcription                   │
    │                     │                       │                       │
    │                     │                   Store in DB                 │
    │                     │                   Send notifications          │
    │                     │                   (SMS + Email)               │
    │                     │                       │                       │


┌─────────────────────────────────────────────────────────────────────────────┐
│                              ADMIN DASHBOARD                                 │
└─────────────────────────────────────────────────────────────────────────────┘

  Admin                   Dominium Server              PostgreSQL
    │                           │                           │
    │── GET /admin ────────────▶│                           │
    │                           │── Check session ─────────▶│
    │◀─ Redirect /auth/google ──│                           │
    │                           │                           │
    │── Google OAuth Flow ─────▶│                           │
    │◀─ Set session cookie ─────│                           │
    │                           │                           │
    │── GET /admin ────────────▶│                           │
    │                           │── Query calls, voicemails─▶│
    │◀─ Dashboard HTML ─────────│◀──────────────────────────│
    │                           │                           │
```

---

## Database Schema (PostgreSQL)

Using raw `pg` library with plain SQL - no ORM.

### Schema Definition

```sql
-- db/schema.sql

-- Users (Google OAuth)
CREATE TABLE users (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  google_id TEXT UNIQUE NOT NULL,
  picture TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

-- Sessions
CREATE TABLE sessions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Calls
CREATE TABLE calls (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  twilio_sid TEXT UNIQUE NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  status TEXT NOT NULL DEFAULT 'initiated',
  from_number TEXT NOT NULL,
  to_number TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  answered_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration INTEGER,
  routed_to TEXT CHECK (routed_to IN ('retell_agent', 'voicemail', 'forward', 'hangup')),
  recording_url TEXT,
  recording_sid TEXT,
  caller_city TEXT,
  caller_state TEXT,
  caller_country TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_calls_from_number ON calls(from_number);
CREATE INDEX idx_calls_started_at ON calls(started_at DESC);

-- Voicemails
CREATE TABLE voicemails (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  call_id TEXT UNIQUE NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  audio_url TEXT NOT NULL,
  duration INTEGER NOT NULL,
  transcript TEXT,
  transcription_status TEXT DEFAULT 'pending' CHECK (transcription_status IN ('pending', 'processing', 'completed', 'failed')),
  is_read BOOLEAN DEFAULT FALSE,
  is_archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_voicemails_unread ON voicemails(is_read, is_archived) WHERE NOT is_read AND NOT is_archived;

-- Settings (key-value store for config)
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT REFERENCES users(id)
);

-- SMS Consent
CREATE TABLE consents (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  phone_number TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('opted_in', 'opted_out', 'pending')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Consent Audit Log
CREATE TABLE consent_audits (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  consent_id TEXT NOT NULL REFERENCES consents(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_consent_audits_consent_id ON consent_audits(consent_id);

-- Default settings
INSERT INTO settings (key, value) VALUES
  ('business_hours', '{"timezone": "America/Edmonton", "always_open": true}'),
  ('routing_rules', '{"default": "retell_agent", "after_hours": "voicemail"}'),
  ('voicemail_greeting', '{"message": "Thank you for calling Dominium. Please leave a message after the tone.", "voice": "alice"}'),
  ('notifications', '{"enabled": true, "contacts": [{"name": "Maurice Tran", "phone": "+14036697775", "email": "maurice.tran@dominium.ca"}], "channels": {"email": false, "sms": true}}');
```

### Usage Example

```typescript
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Query calls
const { rows: calls } = await pool.query(`
  SELECT c.*, v.transcript, v.audio_url
  FROM calls c
  LEFT JOIN voicemails v ON v.call_id = c.id
  WHERE c.status = 'completed'
  ORDER BY c.started_at DESC
  LIMIT 20
`);

// Get setting
const { rows } = await pool.query(`SELECT value FROM settings WHERE key = $1`, ['business_hours']);
const businessHours = rows[0]?.value;

// Insert call
await pool.query(`
  INSERT INTO calls (twilio_sid, direction, status, from_number, to_number, started_at, routed_to)
  VALUES ($1, $2, $3, $4, $5, $6, $7)
  RETURNING id
`, [twilioSid, 'inbound', 'ringing', fromNumber, toNumber, new Date(), 'retell_agent']);
```

### Database Environments

| Environment | Database | Purpose |
|-------------|----------|---------|
| Development | Local PostgreSQL | Local development |
| Staging | Railway PostgreSQL (staging) | Testing with real Twilio sandbox |
| Production | Railway PostgreSQL (production) | Live data |

Each environment has its own `DATABASE_URL` in Railway.

---

## API Endpoints

### Voice Webhooks (Twilio)

| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/voice/incoming` | POST | Incoming call webhook | Twilio signature |
| `/voice/status` | POST | Call status updates | Twilio signature |
| `/voice/recording` | POST | Recording complete | Twilio signature |
| `/voice/transcription` | POST | Transcription complete | Twilio signature |

### Authentication

| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/auth/google` | GET | Initiate Google OAuth | None |
| `/auth/google/callback` | GET | OAuth callback | None |
| `/auth/logout` | POST | Logout | Session |
| `/auth/me` | GET | Current user info | Session |

### Admin API

| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/admin/calls` | GET | List calls (paginated) | Session |
| `/admin/calls/:id` | GET | Call details | Session |
| `/admin/voicemails` | GET | List voicemails | Session |
| `/admin/voicemails/:id` | GET | Voicemail details | Session |
| `/admin/voicemails/:id/read` | POST | Mark as read | Session |
| `/admin/voicemails/:id/archive` | POST | Archive voicemail | Session |
| `/admin/settings` | GET | Get all settings | Session |
| `/admin/settings/:key` | PUT | Update setting | Session |

### Existing Endpoints (SMS Consent)

| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/api/start-verification` | POST | Send OTP | Rate limited |
| `/api/verify-code` | POST | Verify OTP | Rate limited |
| `/api/get-status` | GET | Get consent status | Session token |
| `/api/set-status` | POST | Update consent | Session token |
| `/api/compliance-info` | GET | Compliance display | None |

---

## Voice Endpoint Details

### POST /voice/incoming

Called by Twilio when an inbound call arrives.

**Request (from Twilio):**
```
CallSid=CA123...
From=+12505551234
To=+18005551234
CallerCity=Calgary
CallerState=AB
CallerCountry=CA
Direction=inbound
```

**Response (TwiML):**

*During business hours:*
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Sip>sip:your-agent@your-retell-sip.pstn.twilio.com</Sip>
  </Dial>
</Response>
```

*After hours (voicemail):*
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">
    Thank you for calling Dominium. We are currently unavailable.
    Please leave a message after the tone and we will return your call.
  </Say>
  <Record
    maxLength="120"
    transcribe="true"
    transcribeCallback="/voice/transcription"
    recordingStatusCallback="/voice/recording"
    recordingStatusCallbackEvent="completed"
  />
  <Say voice="alice">Thank you for your message. Goodbye.</Say>
</Response>
```

**Server Logic:**
```typescript
async function handleIncomingCall(req: Request): Promise<TwiML> {
  const { CallSid, From, To, CallerCity, CallerState, CallerCountry } = req.body;

  // 1. Determine routing based on business hours
  const settings = await getSettings();
  const destination = isBusinessHours(settings) ? 'retell_agent' : 'voicemail';

  // 2. Log the call
  await pool.query(`
    INSERT INTO calls (twilio_sid, direction, status, from_number, to_number, started_at, routed_to, caller_city, caller_state, caller_country)
    VALUES ($1, 'inbound', 'ringing', $2, $3, NOW(), $4, $5, $6, $7)
  `, [CallSid, From, To, destination, CallerCity, CallerState, CallerCountry]);

  // 3. Return appropriate TwiML
  if (destination === 'retell_agent') {
    const sipUri = await registerRetellCall(From, To);
    return dialRetellTwiML(sipUri);
  } else {
    return voicemailTwiML(settings.voicemail_greeting);
  }
}
```

### POST /voice/status

Called by Twilio when call status changes.

**Request:**
```
CallSid=CA123...
CallStatus=completed
CallDuration=45
```

**Server Logic:**
```typescript
async function handleCallStatus(req: Request): Promise<void> {
  const { CallSid, CallStatus, CallDuration, Timestamp } = req.body;

  await pool.query(`
    UPDATE calls SET
      status = $1,
      duration = $2,
      ended_at = $3
    WHERE twilio_sid = $4
  `, [
    mapTwilioStatus(CallStatus),
    parseInt(CallDuration) || null,
    CallStatus === 'completed' ? new Date(Timestamp) : null,
    CallSid
  ]);
}
```

### POST /voice/recording

Called when recording is complete.

**Request:**
```
CallSid=CA123...
RecordingSid=RE456...
RecordingUrl=https://api.twilio.com/2010-04-01/Accounts/.../Recordings/RE456
RecordingDuration=30
```

**Server Logic:**
```typescript
async function handleRecording(req: Request): Promise<void> {
  const { CallSid, RecordingSid, RecordingUrl, RecordingDuration } = req.body;
  const audioUrl = RecordingUrl + '.mp3';

  // Update call with recording info
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
    `, [rows[0].id, audioUrl, parseInt(RecordingDuration)]);
  }
}
```

### POST /voice/transcription

Called when transcription is complete.

**Request:**
```
CallSid=CA123...
TranscriptionText=Hi this is John calling about...
TranscriptionStatus=completed
```

**Server Logic:**
```typescript
async function handleTranscription(req: Request): Promise<void> {
  const { CallSid, TranscriptionText, TranscriptionStatus } = req.body;
  const status = TranscriptionStatus === 'completed' ? 'completed' : 'failed';

  // Update voicemail with transcript
  const { rows } = await pool.query(`
    UPDATE voicemails v SET
      transcript = $1,
      transcription_status = $2
    FROM calls c
    WHERE v.call_id = c.id AND c.twilio_sid = $3
    RETURNING v.id, c.from_number, c.started_at, v.duration, v.audio_url
  `, [TranscriptionText, status, CallSid]);

  // Send notifications
  if (rows[0] && status === 'completed') {
    await sendVoicemailNotifications(rows[0], TranscriptionText);
  }
}
```

---

## Voicemail Notifications

When a voicemail transcription is complete, notifications are sent via SMS and email.

### Notification Flow

```
Transcription Complete
        │
        ▼
┌───────────────────┐
│ Get notification  │
│ settings from DB  │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ For each contact: │
├───────────────────┤
│ • Send SMS        │
│ • Send Email      │
└───────────────────┘
```

### SMS Notification

```typescript
async function sendSmsNotification(
  contact: { phone: string; name: string },
  call: Call,
  transcript: string
): Promise<void> {
  const message = `New voicemail from ${formatPhone(call.fromNumber)}:
"${transcript.substring(0, 100)}${transcript.length > 100 ? '...' : ''}"
Listen: ${process.env.APP_URL}/admin/voicemails/${call.voicemail.id}`;

  await twilioClient.messages.create({
    to: contact.phone,
    messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
    body: message,
  });
}
```

### Email Notification

Using a simple SMTP service (like SendGrid, Postmark, or AWS SES):

```typescript
async function sendEmailNotification(
  contact: { email: string; name: string },
  call: Call,
  transcript: string
): Promise<void> {
  await sendEmail({
    to: contact.email,
    subject: `New Voicemail from ${formatPhone(call.fromNumber)}`,
    html: `
      <h2>New Voicemail</h2>
      <p><strong>From:</strong> ${formatPhone(call.fromNumber)}</p>
      <p><strong>Time:</strong> ${formatDate(call.startedAt)}</p>
      <p><strong>Duration:</strong> ${formatDuration(call.voicemail.duration)}</p>

      <h3>Transcript</h3>
      <p>${transcript}</p>

      <p>
        <a href="${process.env.APP_URL}/admin/voicemails/${call.voicemail.id}">
          Listen to voicemail
        </a>
      </p>
    `,
  });
}
```

### Environment Variables for Notifications

```bash
# Email (SendGrid example)
SENDGRID_API_KEY=SG.xxxxxxxxxx
EMAIL_FROM=notifications@dominium.ca

# Or SMTP
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=user
SMTP_PASS=password
EMAIL_FROM=notifications@dominium.ca
```

---

## Authentication Flow

### Google OAuth 2.0

```
┌─────────┐          ┌─────────────┐          ┌────────────┐
│  User   │          │   Server    │          │   Google   │
└────┬────┘          └──────┬──────┘          └─────┬──────┘
     │                      │                       │
     │── GET /admin ───────▶│                       │
     │                      │                       │
     │◀─ 302 /auth/google ──│                       │
     │                      │                       │
     │── GET /auth/google ─▶│                       │
     │                      │                       │
     │◀─ 302 Google OAuth ──│                       │
     │                      │                       │
     │──────────────────────────────────────────────▶│
     │                      │                       │
     │◀─────────────── Google Login Page ───────────│
     │                      │                       │
     │─────────────── User Authenticates ──────────▶│
     │                      │                       │
     │◀─ 302 /auth/google/callback?code=xxx ────────│
     │                      │                       │
     │── GET /auth/google/callback?code=xxx ───────▶│
     │                      │                       │
     │                      │── Exchange code ─────▶│
     │                      │                       │
     │                      │◀─ Access token ───────│
     │                      │                       │
     │                      │── Get user info ─────▶│
     │                      │                       │
     │                      │◀─ Email, name, etc ───│
     │                      │                       │
     │                      │ Verify domain is      │
     │                      │ @dominium.ca          │
     │                      │                       │
     │                      │ Create/update user    │
     │                      │ Create session        │
     │                      │                       │
     │◀─ 302 /admin + cookie│                       │
     │                      │                       │
```

### Domain Restriction

Only emails from the Dominium workspace are allowed:

```typescript
const ALLOWED_DOMAIN = 'dominium.ca'; // or your actual domain

async function handleGoogleCallback(profile: GoogleProfile): Promise<User> {
  const email = profile.emails[0].value;
  const domain = email.split('@')[1];

  if (domain !== ALLOWED_DOMAIN) {
    throw new Error('Access restricted to Dominium workspace');
  }

  // Create or update user (upsert)
  const { rows } = await pool.query(`
    INSERT INTO users (google_id, email, name, picture, last_login_at)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (google_id) DO UPDATE SET
      email = $2,
      name = $3,
      picture = $4,
      last_login_at = NOW()
    RETURNING *
  `, [profile.id, email, profile.displayName, profile.photos?.[0]?.value]);

  return rows[0];
}
```

---

## Admin Dashboard UI

### Pages

| Page | Path | Description |
|------|------|-------------|
| Login | `/admin/login` | Google sign-in button |
| Dashboard | `/admin` | Overview stats, recent calls |
| Calls | `/admin/calls` | Call log with filters |
| Voicemails | `/admin/voicemails` | Voicemail inbox |
| Settings | `/admin/settings` | Configuration |

### Dashboard Wireframe

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  DOMINIUM CRM                                    [user@dominium.ca] [Logout]│
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   TODAY     │  │  THIS WEEK  │  │  VOICEMAILS │  │   UNREAD    │        │
│  │     12      │  │     47      │  │      8      │  │      3      │        │
│  │   calls     │  │   calls     │  │   total     │  │  voicemails │        │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘        │
│                                                                             │
│  RECENT CALLS                                              [View All Calls] │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ From            │ Time              │ Duration │ Status    │ Action │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │ +1 (250) 555-1234│ Today 2:34 PM    │ 0:45    │ Voicemail │ [Play] │   │
│  │ +1 (403) 555-5678│ Today 1:12 PM    │ 2:30    │ Completed │        │   │
│  │ +1 (780) 555-9012│ Today 11:45 AM   │ 0:22    │ Voicemail │ [Play] │   │
│  │ +1 (250) 555-3456│ Yesterday 4:30 PM│ 1:15    │ Completed │        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  UNREAD VOICEMAILS                                    [View All Voicemails] │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ● +1 (250) 555-1234 - Today 2:34 PM - 0:45                          │   │
│  │   "Hi, this is John calling about the property on 5th avenue..."    │   │
│  │   [Play] [Mark Read] [Archive]                                      │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │ ● +1 (780) 555-9012 - Today 11:45 AM - 0:22                         │   │
│  │   "Hello, I'm interested in scheduling a viewing for..."            │   │
│  │   [Play] [Mark Read] [Archive]                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Settings Page Wireframe

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  DOMINIUM CRM > Settings                         [user@dominium.ca] [Logout]│
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  BUSINESS HOURS                                                    [Edit]   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Timezone: America/Edmonton (Mountain Time)                          │   │
│  │                                                                     │   │
│  │ Monday    : 9:00 AM - 5:00 PM                                       │   │
│  │ Tuesday   : 9:00 AM - 5:00 PM                                       │   │
│  │ Wednesday : 9:00 AM - 5:00 PM                                       │   │
│  │ Thursday  : 9:00 AM - 5:00 PM                                       │   │
│  │ Friday    : 9:00 AM - 5:00 PM                                       │   │
│  │ Saturday  : Closed                                                  │   │
│  │ Sunday    : Closed                                                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  CALL ROUTING                                                      [Edit]   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ During business hours : Route to Retell Agent                       │   │
│  │ After hours           : Voicemail                                   │   │
│  │                                                                     │   │
│  │ Retell SIP URI: sip:agent-xxx@xxx.pstn.twilio.com                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  VOICEMAIL GREETING                                                [Edit]   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Voice: Alice (en-US)                                                │   │
│  │                                                                     │   │
│  │ Message:                                                            │   │
│  │ "Thank you for calling Dominium. We are currently unavailable.      │   │
│  │  Please leave a message after the tone and we will return your      │   │
│  │  call as soon as possible."                                         │   │
│  │                                                                     │   │
│  │ [Preview] [Save]                                                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Environment Variables

### All Environments

```bash
# Server
PORT=3000
NODE_ENV=development|staging|production
APP_URL=https://your-domain.com

# Database
DATABASE_URL=postgresql://user:password@host:5432/dbname

# Twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_VERIFY_SERVICE_SID=VAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_MESSAGING_SERVICE_SID=MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+18005551234

# Retell AI
RETELL_API_KEY=key_xxxxxxxxxxxxxxxx
RETELL_AGENT_ID=agent_xxxxxxxxxxxxxxxx

# Google OAuth
GOOGLE_CLIENT_ID=xxxxxxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxxxxxxxxxx
GOOGLE_CALLBACK_URL=https://your-domain.com/auth/google/callback

# Session
SESSION_SECRET=your-secure-random-string

# Email Notifications (SendGrid)
SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxx
EMAIL_FROM=notifications@dominium.ca

# App Config
ALLOWED_DOMAIN=dominium.ca
BRAND_NAME=Dominium
```

### Railway Environment Setup

**Staging:**
```
DATABASE_URL=postgresql://...@staging-db.railway.internal:5432/railway
GOOGLE_CALLBACK_URL=https://backend-staging-e8f7.up.railway.app/auth/google/callback
NODE_ENV=staging
```

**Production:**
```
DATABASE_URL=postgresql://...@production-db.railway.internal:5432/railway
GOOGLE_CALLBACK_URL=https://dominium-crm.com/auth/google/callback
NODE_ENV=production
```

---

## Google Cloud Console Setup

### 1. Create Project

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create new project: "Dominium CRM"
3. Note the Project ID

### 2. Enable APIs

1. Go to "APIs & Services" > "Library"
2. Enable "Google+ API" (for profile info)
3. Enable "Google People API" (optional, for contacts later)

### 3. Configure OAuth Consent Screen

1. Go to "APIs & Services" > "OAuth consent screen"
2. Choose "Internal" (restricts to your Workspace domain)
3. Fill in:
   - App name: "Dominium CRM"
   - User support email: your email
   - Developer contact: your email
4. Add scopes:
   - `email`
   - `profile`
   - `openid`
5. Save

### 4. Create OAuth Credentials

1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "OAuth client ID"
3. Application type: "Web application"
4. Name: "Dominium CRM Web"
5. Authorized JavaScript origins:
   - `http://localhost:3000` (development)
   - `https://backend-staging-e8f7.up.railway.app` (staging)
   - `https://dominium-crm.com` (production, when ready)
6. Authorized redirect URIs:
   - `http://localhost:3000/auth/google/callback`
   - `https://backend-staging-e8f7.up.railway.app/auth/google/callback`
   - `https://dominium-crm.com/auth/google/callback`
7. Click "Create"
8. Copy Client ID and Client Secret

---

## Twilio Configuration

### 1. Phone Number Webhook

Configure your Twilio phone number to use the server webhook:

1. Go to [Twilio Console](https://console.twilio.com) > Phone Numbers
2. Select your number
3. Under "Voice & Fax":
   - Configure with: Webhook
   - A call comes in: `https://backend-staging-e8f7.up.railway.app/voice/incoming`
   - HTTP: POST
4. Save

### 2. Webhook Signature Validation

Validate that webhooks are from Twilio:

```typescript
import twilio from 'twilio';

function validateTwilioRequest(req: Request): boolean {
  const signature = req.headers['x-twilio-signature'] as string;
  const url = `https://${req.headers.host}${req.originalUrl}`;

  return twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN!,
    signature,
    url,
    req.body
  );
}
```

### 3. Retell API Integration

Retell uses a dynamic SIP URI - you must register each call first.

**Retell API Endpoint:**
```
POST https://api.retellai.com/v2/register-phone-call
```

**Request:**
```json
{
  "agent_id": "your-agent-id",
  "from_number": "+12505551234",
  "to_number": "+18005551234",
  "direction": "inbound"
}
```

**Response:**
```json
{
  "call_id": "call_abc123xyz",
  "agent_id": "your-agent-id"
}
```

**SIP URI Format:**
```
sip:{call_id}@sip.retellai.com
```

**Server Flow:**
```typescript
async function registerRetellCall(fromNumber: string, toNumber: string): Promise<string> {
  const response = await fetch('https://api.retellai.com/v2/register-phone-call', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RETELL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      agent_id: process.env.RETELL_AGENT_ID,
      from_number: fromNumber,
      to_number: toNumber,
      direction: 'inbound',
    }),
  });

  const { call_id } = await response.json();
  return `sip:${call_id}@sip.retellai.com`;
}
```

**TwiML Response:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Sip>sip:call_abc123xyz@sip.retellai.com</Sip>
  </Dial>
</Response>
```

**Environment Variables:**
```
RETELL_API_KEY=your-retell-api-key
RETELL_AGENT_ID=your-retell-agent-id
```

**Where to Find These:**
1. Log into [Retell Dashboard](https://dashboard.retellai.com)
2. API Key: Settings → API Keys
3. Agent ID: Agents → Select your agent → Copy ID from URL or settings

---

## Implementation Phases

### Phase 1: Database & Voice Endpoints
- [ ] Set up PostgreSQL on Railway (staging)
- [ ] Run schema.sql to create tables
- [ ] Add `pg` library and db connection pool
- [ ] Implement `/voice/incoming` with Retell registration
- [ ] Implement `/voice/status`, `/voice/recording`, `/voice/transcription`
- [ ] Test with Twilio

### Phase 2: Authentication
- [ ] Set up Google OAuth with Passport.js
- [ ] Implement session management
- [ ] Create login/logout endpoints
- [ ] Add domain restriction

### Phase 3: Admin API
- [ ] Implement `/admin/calls` endpoints
- [ ] Implement `/admin/voicemails` endpoints
- [ ] Implement `/admin/settings` endpoints

### Phase 4: Admin Dashboard UI
- [ ] Create dashboard page
- [ ] Create calls list page
- [ ] Create voicemails page with audio player
- [ ] Create settings page

### Phase 5: Polish & Production
- [ ] Add error handling and logging
- [ ] Set up production database
- [ ] Configure production OAuth
- [ ] Deploy to production

---

## File Structure

```
dominium-crm/
├── db/
│   └── schema.sql               # Database schema
├── src/
│   ├── index.ts                 # Express app entry
│   ├── routes/
│   │   ├── api.ts               # SMS consent API (existing)
│   │   ├── voice.ts             # Voice webhooks
│   │   ├── auth.ts              # Google OAuth
│   │   └── admin.ts             # Admin API
│   ├── services/
│   │   ├── twilio.ts            # Twilio client (existing)
│   │   ├── consent.ts           # Consent management (existing)
│   │   ├── calls.ts             # Call management
│   │   ├── voicemail.ts         # Voicemail management
│   │   └── settings.ts          # Settings management
│   ├── middleware/
│   │   ├── auth.ts              # Session auth (existing)
│   │   ├── googleAuth.ts        # Google OAuth middleware
│   │   └── twilioValidation.ts  # Twilio webhook validation
│   ├── lib/
│   │   ├── db.ts                # PostgreSQL connection pool
│   │   ├── twiml.ts             # TwiML builders
│   │   └── businessHours.ts     # Time/routing logic
│   └── types/
│       └── index.ts             # TypeScript types
├── public/
│   ├── index.html               # SMS consent portal (existing)
│   ├── admin/
│   │   ├── index.html           # Admin dashboard
│   │   ├── calls.html           # Calls page
│   │   ├── voicemails.html      # Voicemails page
│   │   └── settings.html        # Settings page
│   ├── css/
│   │   ├── styles.css           # Consent portal styles (existing)
│   │   └── admin.css            # Admin styles
│   └── js/
│       ├── app.js               # Consent portal JS (existing)
│       └── admin.js             # Admin JS
├── docs/
│   └── voice-crm-spec.md        # This document
├── package.json
├── tsconfig.json
└── .env.example
```

---

## Security Considerations

1. **Twilio Webhook Validation** - Always validate `X-Twilio-Signature`
2. **OAuth Domain Restriction** - Only allow @dominium.ca emails
3. **Session Security** - HttpOnly, Secure, SameSite cookies
4. **Rate Limiting** - Already implemented for SMS endpoints
5. **HTTPS Only** - Railway provides SSL by default
6. **Database Credentials** - Use Railway's internal networking
7. **No Secrets in Code** - All credentials in environment variables

---

## Questions to Resolve

### Resolved
- [x] Google Workspace domain: `dominium.ca`
- [x] Voicemail notifications: SMS + Email to specified contacts
- [x] Retell integration: Dynamic SIP via Register Phone Call API
- [x] Retell API Key: Stored in swarmify keys
- [x] Retell Agent ID: `agent_7bd572d93cadd282bf67e0a306`
- [x] Notification contact: Maurice Tran (+1 403-669-7775, maurice.tran@dominium.ca)

### Still Needed
1. **Email service** - No email service yet. **Starting with SMS-only notifications.** Can add email later (SendGrid, Postmark, etc.)
2. **Any specific branding** for admin UI? (colors, logo, etc.)
