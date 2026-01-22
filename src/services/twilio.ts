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
 * Send OTP verification code to phone number
 */
export async function startVerification(phoneNumber: string): Promise<{ success: boolean; message: string }> {
  try {
    const verification = await client.verify.v2
      .services(verifyServiceSid!)
      .verifications.create({
        to: phoneNumber,
        channel: 'sms',
      });

    return {
      success: verification.status === 'pending',
      message: verification.status === 'pending'
        ? 'Verification code sent'
        : 'Failed to send verification code',
    };
  } catch (error) {
    console.error('Twilio verification error:', error);
    return {
      success: false,
      message: 'Failed to send verification code. Please try again.',
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
