import twilio from 'twilio';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

if (!accountSid || !authToken || !verifyServiceSid) {
  console.warn('Warning: Twilio credentials not fully configured');
}

const client = twilio(accountSid, authToken);

/**
 * Validate Twilio configuration on startup
 */
export async function validateTwilioConfig(): Promise<{ valid: boolean; error?: string }> {
  if (!accountSid || !authToken || !verifyServiceSid) {
    return { valid: false, error: 'Missing required Twilio credentials' };
  }

  // Validate SID format
  if (!verifyServiceSid.startsWith('VA')) {
    return { valid: false, error: `Invalid Verify Service SID format: should start with 'VA', got '${verifyServiceSid.substring(0, 2)}'` };
  }

  try {
    // Try to fetch the verify service to confirm it exists
    const service = await client.verify.v2.services(verifyServiceSid).fetch();
    console.log('Twilio Verify service validated:', {
      sid: service.sid,
      friendlyName: service.friendlyName,
      codeLength: service.codeLength,
    });
    return { valid: true };
  } catch (error: any) {
    console.error('Twilio config validation failed:', {
      message: error.message,
      code: error.code,
      status: error.status,
    });
    return { valid: false, error: `Verify service validation failed: ${error.message}` };
  }
}

/**
 * Send OTP verification code to phone number
 */
export async function startVerification(phoneNumber: string): Promise<{ success: boolean; message: string }> {
  // Log configuration status for debugging
  console.log('Twilio config check:', {
    hasAccountSid: !!accountSid,
    hasAuthToken: !!authToken,
    hasVerifyServiceSid: !!verifyServiceSid,
    verifyServiceSidPrefix: verifyServiceSid?.substring(0, 2),
    phoneNumber: phoneNumber,
  });

  try {
    const verification = await client.verify.v2
      .services(verifyServiceSid!)
      .verifications.create({
        to: phoneNumber,
        channel: 'sms',
      });

    console.log('Verification sent successfully:', verification.status);
    return {
      success: verification.status === 'pending',
      message: verification.status === 'pending'
        ? 'Verification code sent'
        : 'Failed to send verification code',
    };
  } catch (error: any) {
    console.error('Twilio verification error:', {
      message: error.message,
      code: error.code,
      status: error.status,
      moreInfo: error.moreInfo,
    });

    // Provide more specific error messages
    let userMessage = 'Failed to send verification code. Please try again.';
    if (error.code === 20003) {
      userMessage = 'Service authentication error. Please contact support.';
    } else if (error.code === 20404) {
      userMessage = 'Verification service not found. Please contact support.';
    } else if (error.message?.includes('not valid')) {
      userMessage = 'Configuration error. Please contact support.';
    }

    return {
      success: false,
      message: userMessage,
    };
  }
}

/**
 * Check OTP verification code
 */
export async function checkVerification(
  phoneNumber: string,
  code: string
): Promise<{ success: boolean; message: string }> {
  try {
    const verificationCheck = await client.verify.v2
      .services(verifyServiceSid!)
      .verificationChecks.create({
        to: phoneNumber,
        code: code,
      });

    return {
      success: verificationCheck.status === 'approved',
      message: verificationCheck.status === 'approved'
        ? 'Phone number verified'
        : 'Invalid verification code',
    };
  } catch (error) {
    console.error('Twilio verification check error:', error);
    return {
      success: false,
      message: 'Verification failed. Please try again.',
    };
  }
}

/**
 * Send confirmation SMS after consent change
 */
export async function sendConfirmationSms(
  phoneNumber: string,
  status: 'opted_in' | 'opted_out',
  brandName: string
): Promise<boolean> {
  if (!messagingServiceSid) {
    console.warn('Messaging service SID not configured, skipping confirmation SMS');
    return false;
  }

  try {
    const message = status === 'opted_in'
      ? `You have opted in to receive SMS messages from ${brandName}. Reply STOP to opt out at any time.`
      : `You have opted out of SMS messages from ${brandName}. You will no longer receive messages. Reply START to opt back in.`;

    await client.messages.create({
      to: phoneNumber,
      messagingServiceSid: messagingServiceSid,
      body: message,
    });

    return true;
  } catch (error) {
    console.error('Failed to send confirmation SMS:', error);
    return false;
  }
}
