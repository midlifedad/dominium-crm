-- Dominium CRM Database Schema
-- Run with: psql $DATABASE_URL -f db/schema.sql

-- Users (Google OAuth)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  google_id TEXT UNIQUE NOT NULL,
  picture TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);

-- Calls
CREATE TABLE IF NOT EXISTS calls (
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

CREATE INDEX IF NOT EXISTS idx_calls_from_number ON calls(from_number);
CREATE INDEX IF NOT EXISTS idx_calls_started_at ON calls(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_twilio_sid ON calls(twilio_sid);

-- Voicemails
CREATE TABLE IF NOT EXISTS voicemails (
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

CREATE INDEX IF NOT EXISTS idx_voicemails_unread ON voicemails(is_read, is_archived) WHERE NOT is_read AND NOT is_archived;
CREATE INDEX IF NOT EXISTS idx_voicemails_created_at ON voicemails(created_at DESC);

-- Settings (key-value store for config)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT REFERENCES users(id)
);

-- SMS Consent
CREATE TABLE IF NOT EXISTS consents (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  phone_number TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('opted_in', 'opted_out', 'pending')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consents_phone ON consents(phone_number);

-- Consent Audit Log
CREATE TABLE IF NOT EXISTS consent_audits (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  consent_id TEXT NOT NULL REFERENCES consents(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consent_audits_consent_id ON consent_audits(consent_id);

-- Default settings (only insert if not exists)
INSERT INTO settings (key, value) VALUES
  ('business_hours', '{"timezone": "America/Edmonton", "always_open": true}'),
  ('routing_rules', '{"default": "retell_agent", "after_hours": "voicemail"}'),
  ('voicemail_greeting', '{"message": "Thank you for calling Dominium. Please leave a message after the tone.", "voice": "alice"}'),
  ('notifications', '{"enabled": true, "contacts": [{"name": "Maurice Tran", "phone": "+14036697775", "email": "maurice.tran@dominium.ca"}], "channels": {"email": false, "sms": true}}')
ON CONFLICT (key) DO NOTHING;
