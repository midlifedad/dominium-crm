import type { ConsentStatus, AuditLogEntry } from '../types/index.js';

// In-memory storage (in production, use a database like PostgreSQL)
const consentStore = new Map<string, { status: ConsentStatus; lastUpdated: Date }>();
const auditLog: AuditLogEntry[] = [];

/**
 * Get consent status for a phone number
 */
export function getConsentStatus(phoneNumber: string): { status: ConsentStatus; lastUpdated?: string } {
  const record = consentStore.get(normalizePhone(phoneNumber));

  if (!record) {
    return { status: 'unknown' };
  }

  return {
    status: record.status,
    lastUpdated: record.lastUpdated.toISOString(),
  };
}

/**
 * Set consent status for a phone number
 */
export function setConsentStatus(
  phoneNumber: string,
  status: 'opted_in' | 'opted_out',
  ipAddress: string,
  userAgent: string
): { success: boolean; previousStatus: ConsentStatus } {
  const normalized = normalizePhone(phoneNumber);
  const previousRecord = consentStore.get(normalized);
  const previousStatus = previousRecord?.status || 'unknown';

  // Update consent store
  consentStore.set(normalized, {
    status,
    lastUpdated: new Date(),
  });

  // Log the change for audit trail
  logAuditEntry({
    phoneNumber: normalized,
    action: 'status_changed',
    previousStatus,
    newStatus: status,
    ipAddress,
    userAgent,
    timestamp: new Date(),
  });

  return { success: true, previousStatus };
}

/**
 * Log verification attempt
 */
export function logVerificationStarted(
  phoneNumber: string,
  ipAddress: string,
  userAgent: string
): void {
  logAuditEntry({
    phoneNumber: normalizePhone(phoneNumber),
    action: 'verification_started',
    ipAddress,
    userAgent,
    timestamp: new Date(),
  });
}

/**
 * Log successful verification
 */
export function logVerificationCompleted(
  phoneNumber: string,
  ipAddress: string,
  userAgent: string
): void {
  logAuditEntry({
    phoneNumber: normalizePhone(phoneNumber),
    action: 'verification_completed',
    ipAddress,
    userAgent,
    timestamp: new Date(),
  });
}

/**
 * Get audit log for a phone number (for compliance reporting)
 */
export function getAuditLog(phoneNumber?: string): AuditLogEntry[] {
  if (!phoneNumber) {
    return [...auditLog];
  }

  const normalized = normalizePhone(phoneNumber);
  return auditLog.filter(entry => entry.phoneNumber === normalized);
}

/**
 * Internal: Add entry to audit log
 */
function logAuditEntry(entry: AuditLogEntry): void {
  auditLog.push(entry);

  // In production, also write to persistent storage
  console.log('Audit:', JSON.stringify(entry));
}

/**
 * Normalize phone number to E.164 format
 */
function normalizePhone(phone: string): string {
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');

  // If starts with 1 and has 11 digits, assume US number
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  // If has 10 digits, assume US number and add +1
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  // Otherwise, assume it already has country code
  return `+${digits}`;
}

/**
 * Sync consent to Twilio Consent Management API
 * Note: This is a placeholder for when the API becomes generally available
 */
export async function syncToTwilioConsent(
  phoneNumber: string,
  status: 'opted_in' | 'opted_out'
): Promise<boolean> {
  // TODO: Implement Twilio Consent Management API integration
  // The API is currently in pilot, so we'll implement this when it's GA
  // For now, consent is stored locally and in audit logs

  console.log(`[Twilio Consent Sync] Would sync ${phoneNumber} as ${status}`);
  return true;
}
