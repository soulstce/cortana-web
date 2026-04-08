const secureStatus = document.getElementById('secureStatus');
const transportStatus = document.getElementById('transportStatus');
const messages = document.getElementById('messages');
const micStatus = document.getElementById('micStatus');
const transcriptEl = document.getElementById('transcript');
const talkButton = document.getElementById('talkButton');
const orbButton = document.getElementById('orbButton');
const topbar = document.querySelector('.topbar');

const POKE_TRIGGER_ID = '9b2309d7-cc85-4025-984c-1c872810feb3';
const secureContext = window.isSecureContext || location.hostname === 'localhost';
const allowMic = secureContext && typeof navigator.mediaDevices !== 'undefined' && !!navigator.mediaDevices.getUserMedia;
let mediaStream = null;
let recorder = null;
let chunks = [];
let recognition = null;
let recognitionFinal = '';
let recognitionInterim = '';
let held = false;
let socket = null;
let socketReady = false;
let speaking = false;

function addMessage(role, text) {
  const node = document.createElement('div');
  node.className = 'message ' + role;
  node.textContent = text;
  messages.appendChild(node);
  messages.scrollTop = messages.scrollHeight;
}

function updateMicStatus(text) {
  micStatus.textContent = text;
}

function updateTransport(text, muted) {
  transportStatus.textContent = text;
  transportStatus.classList.toggle('status-pill-muted', !!muted);
}

function setSecureState() {
  if (!secureContext && location.hostname !== 'localhost') {
    secureStatus.textContent = 'Redirecting to HTTPS…';
    addMessage('system', 'Opening the secure version for microphone access.');
    window.location.replace('https://' + location.host + location.pathname + location.search + location.hash);
    return false;
  }

  secureStatus.textContent = allowMic ? 'Secure microphone context ready' : 'Microphone unavailable';
  return allowMic;
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
    updateTransport('HTTPS relay active', true);
    return;
  }

  const readyTimeout = window.setTimeout(function() {
    if (!socketReady) {
      try { socket.close(); } catch (error) {}
      updateTransport('HTTPS relay active', true);
    }
  }, 1600);

  socket.addEventListener('open', function() {
    socketReady = true;
    window.clearTimeout(readyTimeout);
    updateTransport('WebSocket online', false);
  });

  socket.addEventListener('message', function(event) {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'reply') {
        deliverReply(data.reply || '', data.raw || {});
      }
    } catch (error) {
      deliverReply(String(event.data), {});
    }
  });

  socket.addEventListener('close', function() {
    socketReady = false;
    updateTransport('HTTPS relay active', true);
  });

  socket.addEventListener('error', function() {
    socketReady = false;
    updateTransport('HTTPS relay active', true);
  });
}

async function getPermissionState() {
  try {
    if (!navigator.permissions || !navigator.permissions.query) return 'unknown';
    const permission = await navigator.permissions.query({ name: 'microphone' });
    return permission.state;
  } catch (error) {
    return 'unknown';
  }
}

async function ensureMic() {
  if (!allowMic) {
    throw new Error('Microphone access requires HTTPS.');
  }

  if (!mediaStream) {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  }

  return mediaStream;
}

function startRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    recognition = null;
    recognitionFinal = '';
    recognitionInterim = '';
    return;
  }

  recognitionFinal = '';
  recognitionInterim = '';
  recognition = new SR();
  recognition.lang = 'en-US';
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onresult = function(event) {
    let finalText = '';
    let interimText = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const part = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalText += part + ' ';
      } else {
        interimText += part + ' ';
      }
    }
    if (finalText.trim()) recognitionFinal = (recognitionFinal + ' ' + finalText).trim();
    recognitionInterim = interimText.trim();
    transcriptEl.textContent = recognitionFinal || recognitionInterim || 'Listening…';
  };

  recognition.onerror = function() {
    updateMicStatus('Speech transcription unavailable; sending audio only.');
  };

  try {
    recognition.start();
  } catch (error) {}
}

function stopRecognition() {
  return new Promise(function(resolve) {
    if (!recognition) {
      resolve();
      return;
    }

    const done = function() {
      resolve();
    };

    recognition.onend = done;
    recognition.onerror = done;

    try {
      recognition.stop();
    } catch (error) {
      resolve();
    }
  });
}

async function startRecording() {
  if (held) return;
  if (!setSecureState()) return;

  held = true;
  topbar.classList.add('hero-recording');
  talkButton.classList.add('recording');
  orbButton.classList.add('recording');
  transcriptEl.textContent = 'Listening…';
  updateMicStatus('Requesting microphone permission…');

  try {
    await ensureMic();
    updateMicStatus('Microphone live. Hold to capture voice.');
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.getVoices();
    }

    startRecognition();

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    recorder = new MediaRecorder(mediaStream, { mimeType: mimeType });
    recorder.ondataavailable = function(event) {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    };
    recorder.onstop = function() {};
    chunks = [];
    recorder.start(200);
  } catch (error) {
    held = false;
    topbar.classList.remove('hero-recording');
    talkButton.classList.remove('recording');
    orbButton.classList.remove('recording');
    updateMicStatus(error instanceof Error ? error.message : 'Microphone unavailable.');
    addMessage('assistant', 'Microphone access is required for voice input.');
  }
}

async function stopRecording() {
  if (!held) return;
  held = false;
  topbar.classList.remove('hero-recording');
  talkButton.classList.remove('recording');
  orbButton.classList.remove('recording');
  updateMicStatus('Sending voice packet…');

  const recognitionDone = stopRecognition();

  if (recorder && recorder.state !== 'inactive') {
    try {
      recorder.stop();
    } catch (error) {}
  }

  await recognitionDone;
  await new Promise(function(resolve) { window.setTimeout(resolve, 120); });
  await sendVoicePacket();
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

async function transmitVoicePacket(payload) {
  if (socket && socketReady && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'voice', payload: payload }));
    return { reply: null, raw: null };
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
  return data;
}

function normalizeTranscript() {
  const combined = [recognitionFinal, recognitionInterim].filter(Boolean).join(' ').trim();
  return combined || transcriptEl.textContent.trim() || '';
}

function playVoice(textOrAudio, payload) {
  if (payload && payload.audio && typeof payload.audio === 'string' && payload.audio.indexOf('data:') === 0) {
    try {
      const audio = new Audio(payload.audio);
      audio.play().catch(function() {
        speakText(textOrAudio);
      });
      return;
    } catch (error) {
      speakText(textOrAudio);
      return;
    }
  }
  speakText(textOrAudio);
}

function speakText(text) {
  if (!text || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  utterance.pitch = 0.96;
  utterance.volume = 1;
  window.speechSynthesis.speak(utterance);
}

function deliverReply(reply, payload) {
  if (!reply) return;
  addMessage('assistant', reply);
  playVoice(reply, payload || {});
  updateMicStatus('Voice loop complete.');
}

async function sendVoicePacket() {
  try {
    const transcript = normalizeTranscript();
    const blob = chunks.length ? new Blob(chunks, { type: recorder ? recorder.mimeType : 'audio/webm' }) : null;
    const audio = blob ? await blobToDataUrl(blob) : '';
    const payload = {
      triggerId: POKE_TRIGGER_ID,
      transcript: transcript,
      mimeType: blob ? blob.type : 'audio/webm',
      audio: audio,
      source: 'cortana-web'
    };

    if (transcript) {
      addMessage('user', transcript);
    }

    const response = await transmitVoicePacket(payload);
    const reply = response && (response.reply || response.response || response.tts || '');
    if (reply) {
      deliverReply(reply, response.raw || response);
    }

    transcriptEl.textContent = reply || transcript || 'Ready.';
    updateTransport(socketReady ? 'WebSocket online' : 'HTTPS relay active', !socketReady);
    updateMicStatus('Ready for next prompt.');
  } catch (error) {
    transcriptEl.textContent = 'Ready.';
    updateMicStatus(error instanceof Error ? error.message : 'Voice relay unavailable.');
    addMessage('assistant', error instanceof Error ? error.message : 'Voice relay unavailable.');
  } finally {
    chunks = [];
    recognitionFinal = '';
    recognitionInterim = '';
    recorder = null;
  }
}

function bindHold(el) {
  const start = function(event) {
    event.preventDefault();
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
    if (held) end(event);
  });
  el.addEventListener('touchstart', start, { passive: false });
  el.addEventListener('touchend', end, { passive: false });
}

async function init() {
  if (!setSecureState()) return;

  const permission = await getPermissionState();
  if (permission === 'denied') {
    updateMicStatus('Microphone permission is blocked. Enable it in the browser site settings.');
  } else if (permission === 'prompt') {
    updateMicStatus('Tap and hold to grant microphone access.');
  } else {
    updateMicStatus('Microphone permission ready.');
  }

  addMessage('assistant', 'Hold the orb or the button to speak.');
  connectSocket();
  bindHold(talkButton);
  bindHold(orbButton);
}

init();
