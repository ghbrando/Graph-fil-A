# Frontend

React application deployed on Cloud Run. Provides the full user interface for Graph-fil-A.

## Key Features

- **Login/Signup** — Firebase Auth (Google sign-in)
- **Recording Interface** — MediaRecorder API captures WebM/Opus or WAV audio
- **Mind Map** — Cytoscape.js interactive graph with hierarchical/force-directed layouts, color-coded node types, edge labels, zoom/pan/drag
- **Chat Panel** — Multi-turn AI chat with node highlighting on responses
- **Node Detail Cards** — Click any node for a side panel with entity metadata
- **Session History** — Paginated list of past sessions
- **Real-time Updates** — Firestore `onSnapshot` drives live status changes

## Structure

```
frontend/
├── public/              # Static assets
└── src/
    ├── components/      # React UI components
    │   ├── LoginScreen
    │   ├── RecordingInterface
    │   ├── MindMap          (Cytoscape.js)
    │   ├── ChatPanel
    │   ├── NodeDetailCard
    │   └── SessionHistory
    └── services/        # GCP/Firebase client helpers
        ├── api.js       # Calls to api-router
        ├── auth.js      # Firebase Auth
        └── firestore.js # Firestore onSnapshot bindings
```
