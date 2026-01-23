/**
 * Retell AI Integration Service
 * Handles call registration for SIP connection
 */

const RETELL_API_URL = 'https://api.retellai.com/v2';

interface RegisterCallResponse {
  call_id: string;
  agent_id: string;
}

/**
 * Register a phone call with Retell to get a SIP URI
 * @returns SIP URI to dial (sip:{call_id}@sip.retellai.com)
 */
export async function registerRetellCall(
  fromNumber: string,
  toNumber: string
): Promise<{ success: boolean; sipUri?: string; error?: string }> {
  const apiKey = process.env.RETELL_API_KEY;
  const agentId = process.env.RETELL_AGENT_ID;

  if (!apiKey || !agentId) {
    console.error('Retell credentials not configured');
    return { success: false, error: 'Retell not configured' };
  }

  try {
    const response = await fetch(`${RETELL_API_URL}/register-phone-call`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        agent_id: agentId,
        from_number: fromNumber,
        to_number: toNumber,
        direction: 'inbound',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Retell API error:', response.status, errorText);
      return { success: false, error: `Retell API error: ${response.status}` };
    }

    const data = await response.json() as RegisterCallResponse;
    const sipUri = `sip:${data.call_id}@sip.retellai.com`;

    console.log('Retell call registered:', { callId: data.call_id, sipUri });
    return { success: true, sipUri };
  } catch (error: any) {
    console.error('Retell registration failed:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Validate Retell configuration
 */
export function validateRetellConfig(): { valid: boolean; error?: string } {
  const apiKey = process.env.RETELL_API_KEY;
  const agentId = process.env.RETELL_AGENT_ID;

  if (!apiKey) {
    return { valid: false, error: 'RETELL_API_KEY not set' };
  }
  if (!agentId) {
    return { valid: false, error: 'RETELL_AGENT_ID not set' };
  }
  if (!agentId.startsWith('agent_')) {
    return { valid: false, error: 'RETELL_AGENT_ID should start with "agent_"' };
  }

  return { valid: true };
}
