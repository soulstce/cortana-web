const messages = document.getElementById('messages');
const composer = document.getElementById('composer');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const apiStatus = document.getElementById('apiStatus');
const apiDot = document.getElementById('apiDot');

let ws = null;
let wsReady = false;
let fallbackMode = false;

function addMessage(role, text) {
  const el = document.createElement('div');
  el.className = 'message ' + role;
  el.textContent = text;
  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
  return el;
}

function setStatus(text, state) {
  apiStatus.textContent = text;
  apiDot.classList.remove('live', 'fallback');
  if (state) apiDot.classList.add(state);
}

async function pingApi() {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) throw new Error('health check failed');
    setStatus('API online', 'live');
    return true;
  } catch {
    setStatus('API fallback mode', 'fallback');
    return false;
  }
}

function connectWebSocket() {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = scheme + '//' + location.host + '/ws';

  try {
    ws = new WebSocket(url);
  } catch {
    fallbackMode = true;
    return;
  }

  const openTimer = window.setTimeout(() => {
    if (!wsReady) {
      fallbackMode = true;
      try { ws.close(); } catch {}
    }
  }, 1500);

  ws.addEventListener('open', () => {
    wsReady = true;
    window.clearTimeout(openTimer);
    setStatus('WebSocket connected', 'live');
  });

  ws.addEventListener('message', (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'reply' && typeof data.reply === 'string') {
        addMessage('assistant', data.reply);
      }
    } catch {
      addMessage('assistant', String(event.data));
    }
  });

  ws.addEventListener('close', () => {
    if (!wsReady) {
      fallbackMode = true;
      setStatus('HTTP fallback active', 'fallback');
    }
  });

  ws.addEventListener('error', () => {
    fallbackMode = true;
    setStatus('HTTP fallback active', 'fallback');
  });
}

async function sendViaHttp(message) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Unable to send message.');
  }
  return data.reply;
}

async function handleSend(event) {
  event.preventDefault();
  const message = messageInput.value.trim();
  if (!message) return;

  addMessage('user', message);
  messageInput.value = '';
  sendButton.disabled = true;

  try {
    if (ws && wsReady && ws.readyState === WebSocket.OPEN && !fallbackMode) {
      ws.send(JSON.stringify({ type: 'chat', message }));
      addMessage('system', 'Sent through WebSocket');
    } else {
      const reply = await sendViaHttp(message);
      addMessage('assistant', reply);
    }
  } catch (error) {
    addMessage('assistant', error instanceof Error ? error.message : 'Unexpected error.');
  } finally {
    sendButton.disabled = false;
    messageInput.focus();
  }
}

composer.addEventListener('submit', handleSend);
messageInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    composer.requestSubmit();
  }
});

addMessage('assistant', 'Ready when you are. Text a command and I’ll respond here.');
pingApi().then((online) => {
  if (!online) fallbackMode = true;
  connectWebSocket();
});
