# Cortana Web

A lightweight starter for a browser-based assistant.

## Structure

- backend/main.py - Flask API scaffold
- backend/requirements.txt - Python dependencies
- frontend/index.html - PWA entry point
- frontend/styles.css - App styling
- frontend/app.js - Frontend interaction logic
- frontend/manifest.json - Installable PWA metadata
- frontend/sw.js - Service worker cache handling

## Run locally

### Backend

```bash
cd backend
pip install -r requirements.txt
python main.py
```

### Frontend

Serve the repo root or the frontend folder with a static server so the relative assets resolve correctly.

## API

- GET /api/health
- POST /api/chat
