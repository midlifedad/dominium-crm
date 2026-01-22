// Consent status types
export type ConsentStatus = 'opted_in' | 'opted_out' | 'unknown';

// API Request/Response types
export interface StartVerificationRequest {
  phoneNumber: string;
}

export interface StartVerificationResponse {
  success: boolean;
  message: string;
}

export interface VerifyCodeRequest {
  phoneNumber: string;
  code: string;
}

export interface VerifyCodeResponse {
  success: boolean;
  sessionToken?: string;
  message: string;
}

export interface GetStatusResponse {
  phoneNumber: string;
  status: ConsentStatus;
  lastUpdated?: string;
}

export interface SetStatusRequest {
  status: 'opted_in' | 'opted_out';
}

export interface SetStatusResponse {
  success: boolean;
  status: ConsentStatus;
  message: string;
}

// Session data stored in memory (in production, use Redis or similar)
export interface VerifiedSession {
  phoneNumber: string;
  verifiedAt: Date;
  expiresAt: Date;
  ipAddress: string;
  userAgent: string;
}

// Audit log entry
export interface AuditLogEntry {
  phoneNumber: string;
  action: 'verification_started' | 'verification_completed' | 'status_changed';
  previousStatus?: ConsentStatus;
  newStatus?: ConsentStatus;
  ipAddress: string;
  userAgent: string;
  timestamp: Date;
}

// Compliance information displayed on the page
export interface ComplianceInfo {
  brandName: string;
  messageTypes: string[];
  messageFrequency: string;
  optOutInstructions: string;
  privacyPolicyUrl: string;
  termsUrl: string;
}
