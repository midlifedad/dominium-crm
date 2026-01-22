# Dominium CRM - Twilio SMS Consent Portal

Hosted opt-in/opt-out page for Twilio toll-free verification compliance.

## Features

- Phone number verification via Twilio Verify OTP
- Consent status management (opt-in/opt-out)
- Confirmation SMS on preference changes
- Audit logging for compliance (IP, user agent, timestamp)
- Compliance information display (brand, message types, frequency)
- Rate limiting and security headers

## Tech Stack

- **Backend**: Node.js, Express, TypeScript
- **Frontend**: Vanilla HTML/CSS/JavaScript (single-page app)
- **SMS/OTP**: Twilio Verify API
- **Deployment**: Railway (staging and production)

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/start-verification` | POST | Send OTP code to phone number |
| `/api/verify-code` | POST | Validate OTP, returns session token |
| `/api/get-status` | GET | Get current consent status (auth required) |
| `/api/set-status` | POST | Update opt-in/opt-out (auth required) |
| `/api/compliance-info` | GET | Get compliance display info |
| `/health` | GET | Health check endpoint |

## Setup

### Prerequisites

- Node.js 18+
- Twilio account with:
  - Account SID and Auth Token
  - Verify Service (create at twilio.com/console/verify/services)
  - Messaging Service (for confirmation SMS)

### Installation

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your Twilio credentials
```

### Environment Variables

```
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_VERIFY_SERVICE_SID=your_verify_service_sid
TWILIO_MESSAGING_SERVICE_SID=your_messaging_service_sid
BRAND_NAME=Your Brand Name
```

### Development

```bash
# Run in development mode (with hot reload)
npm run dev

# Build for production
npm run build

# Run production build
npm start
```

## Railway Deployment

1. Connect GitHub repo to Railway
2. Set environment variables in Railway dashboard
3. Deploy to staging first, then production

### Environment Configuration

- **Staging**: Set `NODE_ENV=staging`
- **Production**: Set `NODE_ENV=production`

## User Flow

1. **Enter Phone Number** → Receives 6-digit OTP via SMS
2. **Enter Verification Code** → Validates identity, creates session
3. **View/Update Status** → See current preference, opt in or out

## Compliance

This portal is designed to meet Twilio toll-free verification requirements:

- Displays brand name and message types
- Shows message frequency
- Provides opt-out instructions
- Links to Privacy Policy and Terms
- Logs all consent changes with IP, user agent, timestamp

## License

MIT
