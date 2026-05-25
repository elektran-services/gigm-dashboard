# Mantrac Dashboard

A modern GPS fleet management dashboard built with Next.js 16, React 19, and TypeScript. Monitor vehicles, track positions, generate reports, and configure device settings in real-time.

## Features

- 🚗 **Vehicle Fleet Management** - Monitor all devices with real-time status
- 📍 **Last Position Tracking** - View current locations and ACC status
- 📊 **Comprehensive Reports** - Trips, mileage, parking, overspeed, and offline reports
- 🔔 **Alarm Monitoring** - Real-time alerts and notifications
- ⚙️ **Settings Management** - Configure speed limits (single/batch operations)
- 🎨 **Modern UI** - Clean interface with gold (#FFC107) theme
- 🔐 **Secure Authentication** - Token-based authentication with MD5 password hashing

## Tech Stack

- **Framework**: Next.js 16.1.6 (React 19.2.3)
- **Language**: TypeScript 5
- **Styling**: Tailwind CSS v4
- **API**: GPS51 External API Integration

## Getting Started

### Prerequisites

- Node.js 18+ installed
- npm or yarn package manager
- GPS51 API access

### Installation

1. Clone the repository:
```bash
git clone https://github.com/elektran-studios/mantrac.git
cd mantrac-dashboard
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env.local
```

4. Edit `.env.local` with your configuration:
```env
# GPS51 API Configuration
NEXT_PUBLIC_GPS51_API_URL=https://api.gps51.com/openapi
NEXT_PUBLIC_GPS51_SERVER_ID=2

# Application Configuration
NEXT_PUBLIC_APP_NAME=Mantrac Dashboard
NEXT_PUBLIC_APP_VERSION=1.0.0

# Session Configuration (in milliseconds)
SESSION_TIMEOUT=3600000

# Environment
NODE_ENV=development
```

5. Run the development server:
```bash
npm run dev
```

6. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `NEXT_PUBLIC_GPS51_API_URL` | GPS51 API base URL | Yes | `https://api.gps51.com/openapi` |
| `NEXT_PUBLIC_GPS51_SERVER_ID` | GPS51 server ID | Yes | `2` |
| `NEXT_PUBLIC_HERE_API_KEY` | HERE Maps API key for reverse geocoding | Yes | - |
| `NEXT_PUBLIC_APP_NAME` | Application display name | No | `Mantrac Dashboard` |
| `NEXT_PUBLIC_APP_VERSION` | Application version | No | `1.0.0` |
| `SESSION_TIMEOUT` | Session timeout in milliseconds | No | `3600000` (1 hour) |
| `NODE_ENV` | Environment mode | No | `development` |

**Note**: Variables prefixed with `NEXT_PUBLIC_` are exposed to the browser.

## Project Structure

```
mantrac-dashboard/
├── app/
│   ├── api/              # API route handlers
│   │   ├── alarms/       # Alarm reports endpoint
│   │   ├── devices/      # Device list endpoint
│   │   ├── lastposition/ # Position tracking endpoint
│   │   ├── mileage/      # Mileage reports endpoint
│   │   ├── offline/      # Offline devices endpoint
│   │   ├── overspeed/    # Overspeed reports endpoint
│   │   ├── parking/      # Parking reports endpoint
│   │   └── trips/        # Trip reports endpoint
│   ├── components/       # Shared components
│   │   └── CustomSelect.tsx
│   ├── dashboard/        # Dashboard pages and components
│   │   ├── components/   # Dashboard-specific components
│   │   └── page.tsx      # Main dashboard
│   ├── globals.css       # Global styles
│   ├── layout.tsx        # Root layout
│   └── page.tsx          # Login page
├── lib/
│   ├── auth.ts           # Authentication utilities
│   ├── config.ts         # API configuration
│   └── utils.ts          # Utility functions
├── public/               # Static assets
├── .env.local            # Local environment variables (gitignored)
├── .env.example          # Example environment variables
└── middleware.ts         # Next.js middleware

```

## Available Scripts

```bash
# Development
npm run dev        # Start development server

# Production
npm run build      # Build for production
npm start          # Start production server

# Linting
npm run lint       # Run ESLint
```

## API Integration

The dashboard integrates with the GPS51 API for all fleet management operations. All API calls are proxied through Next.js API routes for security.

### Configuration

API configuration is centralized in `lib/config.ts`:

```typescript
import { buildGPS51Url, buildGPS51LoginUrl } from '@/lib/config';

// Build API URL with action and token
const url = buildGPS51Url('querymonitorlist', token);

// Build login URL
const loginUrl = buildGPS51LoginUrl();
```

### Supported Endpoints

- `login` - User authentication
- `querymonitorlist` - Get device list
- `lastposition` - Get current positions
- `querytrips` - Get trip reports
- `reportmileagedetail` - Get mileage reports
- `reportparkdetailbytime` - Get parking reports
- `reportoffline` - Get offline devices
- `reportalarm` - Get alarm reports
- `sendcmd` - Send command to single device
- `batchoperate` - Batch operations

## Security

- ✅ All API keys stored in environment variables
- ✅ Password hashing with MD5
- ✅ Token-based authentication
- ✅ Secure session management
- ✅ API proxying through Next.js routes
- ✅ HTTPS recommended for production

## Deployment

### Vercel (Recommended)

1. Push your code to GitHub
2. Import project in [Vercel](https://vercel.com)
3. Add environment variables in Vercel dashboard
4. Deploy

### Docker

```bash
# Build image
docker build -t mantrac-dashboard .

# Run container
docker run -p 3000:3000 --env-file .env.local mantrac-dashboard
```

### Manual Deployment

```bash
# Build production bundle
npm run build

# Start production server
npm start
```

**Important**: Ensure all environment variables are set in your production environment.

## License

Copyright © 2026 SafeTrack Technologies. All rights reserved.

## Support

For issues and questions:
- Create an issue on GitHub
- Contact: support@safetrack-tech.com

---

**Powered by SafeTrack Technologies**
