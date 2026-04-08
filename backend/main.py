from pathlib import Path
import json
import os

import httpx
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parents[1]
POKE_WEBHOOK_URL = os.getenv('POKE_WEBHOOK_URL', 'https://poke.com/api/v1/inbound/webhook')
POKE_WEBHOOK_TOKEN = os.getenv('POKE_WEBHOOK_TOKEN', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI4ZDk4OGM2Yi1jZGZjLTQ1ZjEtYTUwMS1kODc0Y2QzOTk4NzMiLCJqdGkiOiI4NmVlYjRiYS0wYjFiLTQzYWQtOTJlZC05MzE3ZGFmYjJmZTIiLCJpYXQiOjE3NzU2MTgyODQsImV4cCI6MjA5MDk3ODI4NH0.KRekg48svNAaGBmvTOjMd4TSFmMBr7WXQvsiLcETEvU')
DEFAULT_TRIGGER_ID = '9b2309d7-cc85-4025-984c-1c872810feb3'

app = FastAPI(title='Cortana Web')
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

class VoicePacket(BaseModel):
    triggerId: str | None = None
    transcript: str = ''
    mimeType: str = 'audio/webm'
    audio: str = ''
    source: str = 'cortana-web'

async def relay_to_poke(payload: VoicePacket) -> dict:
    body = {
        'triggerId': payload.triggerId or DEFAULT_TRIGGER_ID,
        'transcript': payload.transcript.strip(),
        'mimeType': payload.mimeType,
        'audio': payload.audio,
        'source': payload.source,
    }

    async with httpx.AsyncClient(timeout=45) as client:
        response = await client.post(
            POKE_WEBHOOK_URL,
            headers={
                'Authorization': POKE_WEBHOOK_TOKEN,
                'Content-Type': 'application/json',
            },
            json=body,
        )

    try:
        data = response.json()
    except Exception:
        data = {'reply': response.text}

    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=data.get('error') or data.get('message') or 'Poke webhook request failed.')

    return data

@app.get('/api/health')
def health():
    return {'status': 'ok', 'service': 'cortana-web-fastapi', 'voice': True}

@app.post('/api/voice')
async def voice(packet: VoicePacket):
    try:
        data = await relay_to_poke(packet)
        return {
            'ok': True,
            'reply': data.get('reply') or data.get('response') or data.get('tts') or packet.transcript or 'Voice packet delivered.',
            'audio': data.get('audio') or data.get('audioUrl') or data.get('ttsAudio') or data.get('speechAudio'),
            'audioMimeType': data.get('audioMimeType') or data.get('mimeType'),
            'raw': data,
        }
    except Exception as exc:
        return {
            'ok': True,
            'reply': f'Heard: {packet.transcript}'.strip() if packet.transcript else 'Voice packet delivered.',
            'fallback': True,
            'error': str(exc),
        }

@app.websocket('/ws')
async def ws_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            message = await websocket.receive_text()
            try:
                payload = json.loads(message)
            except json.JSONDecodeError:
                payload = {'transcript': message, 'audio': ''}
            packet = VoicePacket(
                triggerId=payload.get('triggerId') or DEFAULT_TRIGGER_ID,
                transcript=str(payload.get('transcript') or '').strip(),
                mimeType=str(payload.get('mimeType') or 'audio/webm'),
                audio=str(payload.get('audio') or ''),
                source=str(payload.get('source') or 'cortana-web'),
            )
            data = await relay_to_poke(packet)
            await websocket.send_text(json.dumps({
                'type': 'reply',
                'reply': data.get('reply') or data.get('response') or data.get('tts') or packet.transcript or 'Voice packet delivered.',
                'audio': data.get('audio') or data.get('audioUrl') or data.get('ttsAudio') or data.get('speechAudio'),
                'audioMimeType': data.get('audioMimeType') or data.get('mimeType'),
                'raw': data,
            }))
    except WebSocketDisconnect:
        return

@app.get('/')
def root():
    return FileResponse(ROOT / 'index.html')

app.mount('/', StaticFiles(directory=str(ROOT), html=True), name='static')

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=8000)
