from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parents[1]
app = FastAPI(title='Cortana Web')

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

class ChatRequest(BaseModel):
    message: str

@app.get('/api/health')
def health():
    return {'status': 'ok', 'service': 'cortana-web-fastapi'}

@app.post('/api/chat')
def chat(payload: ChatRequest):
    message = payload.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail='Message is required.')
    return {'reply': f'Cortana is live. Received: {message}', 'source': 'backend/main.py'}

@app.get('/')
def root():
    return FileResponse(ROOT / 'index.html')

app.mount('/', StaticFiles(directory=str(ROOT), html=True), name='static')

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=8000)
