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
- **Authentication**: Secure user authentication via Supabase
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
- Supabase for authentication and storage
- FFMPEG for video processing
- WebSocket for real-time updates

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
   # In server/.env
   SUPABASE_URL=your_supabase_url
   SUPABASE_ANON_KEY=your_supabase_anon_key
   PORT=3000

   # In client/.env
   VITE_SUPABASE_URL=your_supabase_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   VITE_API_URL=http://localhost:3000
   ```

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
