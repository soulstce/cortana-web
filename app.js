const apiStatus = document.getElementById('apiStatus');
const apiDot = document.getElementById('apiDot');
const messages = document.getElementById('messages');
const transcriptEl = document.getElementById('transcript');
const talkButton = document.getElementById('talkButton');
const orbButton = document.getElementById('orbButton');
const hero = document.querySelector('.hero');

const POKE_TRIGGER_ID = '9b2309d7-cc85-4025-984c-1c872810feb3';
let recorder = null;
let chunks = [];
let mediaStream = null;
let recognition = null;
let transcript = '';
let socket = null;
let socketReady = false;
let holding = false;
let stopTimer = null;

function addMessage(role, text) {
  const el = document.createElement('div');
  el.className = 'message ' + role;
  el.textContent = text;
  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
}

function speak(text) {
  if (!('speechSynthesis' in window) || !text) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  utterance.pitch = 0.95;
  utterance.volume = 1;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function setStatus(text) {
  apiStatus.textContent = text;
}

function getSocketUrl() {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return scheme + '//' + location.host + '/ws';
}

function connectSocket() {
  try {
    socket = new WebSocket(getSocketUrl());
  } catch (error) {
    socketReady = false;
    setStatus('Voice ready');
    return;
  }

  socket.addEventListener('open', function() {
    socketReady = true;
    setStatus('Voice ready');
  });

  socket.addEventListener('message', function(event) {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'reply' && data.reply) {
        addMessage('assistant', data.reply);
        speak(data.reply);
      }
    } catch (error) {
      addMessage('assistant', String(event.data));
    }
  });

  socket.addEventListener('close', function() {
    socketReady = false;
    setStatus('Voice ready');
  });

  socket.addEventListener('error', function() {
    socketReady = false;
    setStatus('Voice ready');
  });
}

async function ensureMic() {
  if (!mediaStream) {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  }
  return mediaStream;
}

function startRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  if (recognition) {
    try { recognition.abort(); } catch (e) {}
  }
  recognition = new SR();
  recognition.lang = 'en-US';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onresult = function(event) {
    let text = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const part = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        text += part + ' ';
      }
    }
    if (text.trim()) {
      transcript = (transcript + ' ' + text).trim();
      transcriptEl.textContent = transcript;
    }
  };
  try { recognition.start(); } catch (e) {}
}

function stopRecognition() {
  if (recognition) {
    try { recognition.stop(); } catch (e) {}
  }
}

async function startRecording() {
  if (holding) return;
  holding = true;
  hero.classList.add('recording');
  talkButton.classList.add('recording');
  apiDot.style.background = '#60a5fa';
  transcript = '';
  transcriptEl.textContent = 'Listening…';
  chunks = [];

  try {
    const stream = await ensureMic();
    const preferred = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    recorder = new MediaRecorder(stream, { mimeType: preferred });
    recorder.ondataavailable = function(event) {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    };
    recorder.onstop = sendVoicePacket;
    recorder.start(250);
    startRecognition();
    setStatus('Listening');
  } catch (error) {
    holding = false;
    hero.classList.remove('recording');
    talkButton.classList.remove('recording');
    setStatus('Voice ready');
    addMessage('assistant', 'Microphone access is required.');
  }
}

function stopRecording() {
  if (!holding) return;
  holding = false;
  hero.classList.remove('recording');
  talkButton.classList.remove('recording');
  setStatus('Sending');
  stopRecognition();
  if (recorder && recorder.state !== 'inactive') {
    try { recorder.stop(); } catch (error) {}
  } else {
    sendVoicePacket();
  }
}

function blobToDataUrl(blob) {
  return new Promise(function(resolve, reject) {
    const reader = new FileReader();
    reader.onloadend = function() {
      resolve(String(reader.result || ''));
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function sendVoicePacket() {
  try {
    const blob = chunks.length ? new Blob(chunks, { type: recorder ? recorder.mimeType : 'audio/webm' }) : null;
    const audio = blob ? await blobToDataUrl(blob) : '';
    const payload = {
      triggerId: POKE_TRIGGER_ID,
      transcript: transcript.trim(),
      mimeType: blob ? blob.type : 'audio/webm',
      audio: audio,
      source: 'cortana-web'
    };

    const reply = await transmitVoicePacket(payload);
    if (reply) {
      addMessage('assistant', reply);
      speak(reply);
    }
    if (transcript.trim()) {
      addMessage('user', transcript.trim());
    }
    transcriptEl.textContent = reply || transcript.trim() || 'Ready.';
    setStatus('Voice ready');
  } catch (error) {
    transcriptEl.textContent = 'Ready.';
    setStatus('Voice ready');
    addMessage('assistant', error instanceof Error ? error.message : 'Voice loop error.');
  } finally {
    chunks = [];
    transcript = '';
  }
}

async function transmitVoicePacket(payload) {
  if (socket && socketReady && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'voice', payload: payload }));
    return null;
  }

  const response = await fetch('/api/voice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Unable to send voice packet.');
  }
  return data.reply || null;
}

function bindHold(el) {
  const start = function(event) {
    event.preventDefault();
    if (stopTimer) {
      clearTimeout(stopTimer);
      stopTimer = null;
    }
    startRecording();
  };
  const end = function(event) {
    event.preventDefault();
    stopRecording();
  };

  el.addEventListener('pointerdown', start);
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('pointerleave', function(event) {
    if (holding) {
      end(event);
    }
  });
  el.addEventListener('touchstart', start, { passive: false });
  el.addEventListener('touchend', end, { passive: false });
}

addMessage('assistant', 'Hold the button or orb to speak.');
connectSocket();
bindHold(talkButton);
bindHold(orbButton);
