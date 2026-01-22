import { Router, Request, Response } from 'express';
import { startVerification, checkVerification, sendConfirmationSms } from '../services/twilio.js';
import {
  getConsentStatus,
  setConsentStatus,
  logVerificationStarted,
  logVerificationCompleted,
  syncToTwilioConsent,
} from '../services/consent.js';
import { createSession, requireSession } from '../middleware/auth.js';
import type {
  StartVerificationRequest,
  VerifyCodeRequest,
  SetStatusRequest,
} from '../types/index.js';

export const apiRouter = Router();

// Brand name for confirmation messages
const BRAND_NAME = process.env.BRAND_NAME || 'Dominium CRM';

/**
 * POST /api/start-verification
 * Send OTP verification code to phone number
 */
apiRouter.post('/start-verification', async (req: Request, res: Response) => {
  try {
    const { phoneNumber } = req.body as StartVerificationRequest;

    if (!phoneNumber) {
      res.status(400).json({ success: false, message: 'Phone number is required' });
      return;
    }

    // Validate phone number format (basic validation)
    const phoneRegex = /^\+?1?\d{10,14}$/;
    const cleanPhone = phoneNumber.replace(/[\s\-\(\)]/g, '');

    if (!phoneRegex.test(cleanPhone)) {
      res.status(400).json({ success: false, message: 'Invalid phone number format' });
      return;
    }

    // Log verification attempt for audit
    logVerificationStarted(
      cleanPhone,
      req.ip || 'unknown',
      req.headers['user-agent'] || 'unknown'
    );

    // Send verification code via Twilio
    const result = await startVerification(cleanPhone);

    res.json(result);
  } catch (error) {
    console.error('Start verification error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * POST /api/verify-code
 * Validate OTP code and create session
 */
apiRouter.post('/verify-code', async (req: Request, res: Response) => {
  try {
    const { phoneNumber, code } = req.body as VerifyCodeRequest;

    if (!phoneNumber || !code) {
      res.status(400).json({ success: false, message: 'Phone number and code are required' });
      return;
    }

    // Validate code format (6 digits)
    if (!/^\d{6}$/.test(code)) {
      res.status(400).json({ success: false, message: 'Code must be 6 digits' });
      return;
    }

    const cleanPhone = phoneNumber.replace(/[\s\-\(\)]/g, '');

    // Verify code with Twilio
    const result = await checkVerification(cleanPhone, code);

    if (!result.success) {
      res.json(result);
      return;
    }

    // Log successful verification
    logVerificationCompleted(
      cleanPhone,
      req.ip || 'unknown',
      req.headers['user-agent'] || 'unknown'
    );

    // Create session token
    const sessionToken = createSession(
      cleanPhone,
      req.ip || 'unknown',
      req.headers['user-agent'] || 'unknown'
    );

    res.json({
      success: true,
      sessionToken,
      message: 'Phone number verified',
    });
  } catch (error) {
    console.error('Verify code error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * GET /api/get-status
 * Get current consent status (requires valid session)
 */
apiRouter.get('/get-status', requireSession, (req: Request, res: Response) => {
  try {
    const phoneNumber = (req as any).phoneNumber;
    const statusInfo = getConsentStatus(phoneNumber);

    res.json({
      phoneNumber,
      ...statusInfo,
    });
  } catch (error) {
    console.error('Get status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/set-status
 * Update consent status (requires valid session)
 */
apiRouter.post('/set-status', requireSession, async (req: Request, res: Response) => {
  try {
    const phoneNumber = (req as any).phoneNumber;
    const { status } = req.body as SetStatusRequest;

    if (!status || !['opted_in', 'opted_out'].includes(status)) {
      res.status(400).json({
        success: false,
        message: 'Status must be "opted_in" or "opted_out"',
      });
      return;
    }

    // Update consent status
    const result = setConsentStatus(
      phoneNumber,
      status,
      req.ip || 'unknown',
      req.headers['user-agent'] || 'unknown'
    );

    // Sync to Twilio Consent API (placeholder for future)
    await syncToTwilioConsent(phoneNumber, status);

    // Send confirmation SMS
    await sendConfirmationSms(phoneNumber, status, BRAND_NAME);

    res.json({
      success: true,
      status,
      message: status === 'opted_in'
        ? 'You have been opted in to receive SMS messages'
        : 'You have been opted out of SMS messages',
    });
  } catch (error) {
    console.error('Set status error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * GET /api/compliance-info
 * Get compliance information for display on the page
 */
apiRouter.get('/compliance-info', (req: Request, res: Response) => {
  res.json({
    brandName: BRAND_NAME,
    messageTypes: [
      'Promotional messages',
      'Service updates',
      'Account notifications',
    ],
    messageFrequency: 'Up to 4 messages per month',
    optOutInstructions: 'Reply STOP to opt out at any time',
    privacyPolicyUrl: process.env.PRIVACY_POLICY_URL || '/privacy',
    termsUrl: process.env.TERMS_URL || '/terms',
  });
});
