# refrAIm - AI-Powered Video Processing Platform

A platform for automatically resizing and reformatting videos for various social media platforms using intelligent content analysis.

## Features

- **Intelligent Video Processing**: Automatically analyze and crop videos for optimal content placement
- **Multi-Platform Support**:
  - Instagram (Stories, Feed Square, Feed Portrait)
  - Facebook (Stories, Feed)
  - TikTok
  - YouTube (Main, Shorts)
- **Modern UI/UX**:
  - Drag-and-drop video upload
  - Real-time processing status
  - Live video previews
  - Toast notifications
- **Authentication**: Gateway SSO via AIDEN Platform (`www.aiden.services`)
- **Cloud Storage**: Reliable video storage using Supabase Storage

## Tech Stack

### Frontend
- React with TypeScript
- Vite for fast development
- TailwindCSS for styling
- React Query for data fetching
- Radix UI for accessible components
- React Router for navigation

### Backend
- Express.js with TypeScript
- Gateway SSO (AIDEN Platform JWT) for authentication
- Supabase Postgres + Storage for data and video files
- FFMPEG for video processing

## Project Structure

```
refraim/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/     # Reusable UI components
│   │   ├── contexts/       # React contexts
│   │   ├── lib/           # Utilities and API client
│   │   └── pages/         # Page components
│   ├── tailwind.config.js
│   └── package.json
├── server/                 # Express backend
│   ├── src/
│   │   ├── controllers/   # Request handlers
│   │   ├── routes/        # API routes
│   │   ├── services/      # Business logic
│   │   └── config/        # Configuration
│   └── package.json
└── package.json           # Workspace configuration
```

## Setup Instructions

### Prerequisites

- Node.js (v16 or higher)
- FFMPEG
- Supabase account

### Quick Start

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd refraim
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   # In server/.env (Railway env in production)
   # Auth (REQUIRED)
   JWT_SECRET=<same value as AIDEN Gateway JWT_SECRET — must match exactly>
   GATEWAY_URL=https://www.aiden.services

   # Supabase (data + storage only, NOT auth)
   SUPABASE_URL=https://bktujlufguenjytbdndn.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service role key>
   SUPABASE_POSTGRES_URL=postgresql://...

   # Stripe billing
   STRIPE_SECRET_KEY=sk_live_...
   STRIPE_PRICE_ID_STARTER=price_...
   STRIPE_PRICE_ID_PRO=price_...
   STRIPE_PRICE_ID_AGENCY=price_...
   STRIPE_WEBHOOK_SECRET=whsec_...

   # Optional — enables Gateway token deductions alongside Stripe (see CLAUDE.md §7)
   AIDEN_SERVICE_KEY=<gateway service key>

   # Other
   ANTHROPIC_API_KEY=sk-ant-...
   CLIENT_URL=https://refraim.aiden.services
   PORT=3000
   NODE_ENV=development

   # In client/.env (Vite build, committed for local dev only)
   VITE_API_URL=/api
   VITE_GATEWAY_URL=https://www.aiden.services
   VITE_SUPABASE_URL=https://bktujlufguenjytbdndn.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon key>
   ```

   **Auth note:** refrAIm uses Gateway SSO. Users log in at `www.aiden.services`. The
   `JWT_SECRET` env var must be identical to the one set on the Gateway Railway service.
   All routes verify the `aiden-gw` HttpOnly cookie; there is no local login form.

4. Start development servers:
   ```bash
   npm run dev
   ```
   This will start both the frontend and backend in development mode.

### Development

- Frontend: http://localhost:5173
- Backend: http://localhost:3000

## Future Plans

### Phase 1: Core Functionality (Current)
- Basic video upload and processing
- Simple FFmpeg-based resizing
- Basic platform-specific output formats
- User authentication and video management

### Phase 2: GPU Acceleration
- Integrate NVIDIA Video Processing Framework (VPF)
- Implement distributed video chunking
- Add GPU-accelerated transcoding
- Optimize for 4K@60FPS throughput

### Phase 3: AI Integration
- Add OpenPose for keypoint detection
- Implement saliency mapping
- Add smart cropping based on content analysis
- Support real-time spatial-temporal analysis

### Phase 4: Advanced Features
- Add user-driven model retraining
- Implement edge caching
- Add multi-CDN delivery
- Support custom filters and effects

### Phase 5: Enterprise Features
- Add team collaboration
- Implement workflow automation
- Add advanced analytics
- Support custom branding

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.
- Backend API: http://localhost:3000

## Contributing

1. Create a feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes and commit:
   ```bash
   git commit -m "feat: add your feature"
   ```

3. Push to your branch and create a pull request

## License

MIT
