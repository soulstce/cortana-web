const secureStatus = document.getElementById('secureStatus');
const micStatus = document.getElementById('micStatus');
const transportStatus = document.getElementById('transportStatus');
const loopState = document.getElementById('loopState');
const transcriptEl = document.getElementById('transcript');
const messages = document.getElementById('messages');
const orbButton = document.getElementById('orbButton');
const hud = document.querySelector('.hud');

const VOICE_TRIGGER_ID = '9b2309d7-cc85-4025-984c-1c872810feb3';
const secureContext = window.isSecureContext || location.hostname === 'localhost';

const state = {
  active: false,
  busy: false,
  listening: false,
  microphoneReady: false,
  loopToken: 0,
  silenceTimer: null,
  stream: null,
  recorder: null,
  recorderMime: 'audio/webm',
  chunks: [],
  recognition: null,
  transcript: '',
  audioContext: null,
};

function addMessage(role, text) {
  const node = document.createElement('div');
  node.className = 'message ' + role;
  node.textContent = text;
  messages.appendChild(node);
  messages.scrollTop = messages.scrollHeight;
}

function setMicStatus(text) { micStatus.textContent = text; }
function setTransportStatus(text, muted) { transportStatus.textContent = text; transportStatus.classList.toggle('pill-muted', !!muted); }
function setLoopState(text) { loopState.textContent = text; }

function setSecureState() {
  if (!secureContext && location.hostname !== 'localhost') {
    secureStatus.textContent = 'Redirecting to HTTPS…';
    addMessage('system', 'Redirecting to the secure version for microphone access.');
    window.location.replace('https://' + location.host + location.pathname + location.search + location.hash);
    return false;
  }
  secureStatus.textContent = 'Secure context ready';
  return true;
}

function ensureAudioContext() {
  if (!state.audioContext) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    state.audioContext = new AudioCtx();
  }
  return state.audioContext;
}

async function primeAudio() {
  const ctx = ensureAudioContext();
  if (ctx && ctx.state !== 'running') {
    try { await ctx.resume(); } catch (error) {}
  }
  if (ctx) {
    try {
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
    } catch (error) {}
  }
}

async function ensureMicrophone() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('Microphone APIs are unavailable in this browser.');
  }
  if (!secureContext && location.hostname !== 'localhost') {
    throw new Error('Microphone access requires HTTPS.');
  }
  if (!state.stream) {
    state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  }
  state.microphoneReady = true;
  return state.stream;
}

async function queryMicPermission() {
  try {
    if (!navigator.permissions || !navigator.permissions.query) return 'unknown';
    const result = await navigator.permissions.query({ name: 'microphone' });
    return result.state;
  } catch (error) {
    return 'unknown';
  }
}

function clearSilenceTimer() {
  if (state.silenceTimer) {
    window.clearTimeout(state.silenceTimer);
    state.silenceTimer = null;
  }
}

function scheduleFinalize() {
  clearSilenceTimer();
  if (!state.active || state.busy) return;
  if (!state.transcript && !state.chunks.length) return;
  state.silenceTimer = window.setTimeout(function() { finalizeUtterance(); }, 850);
}

function stopRecognition() {
  if (state.recognition) {
    try {
      state.recognition.onresult = null;
      state.recognition.onend = null;
      state.recognition.onerror = null;
      state.recognition.stop();
    } catch (error) {}
  }
  state.recognition = null;
}

function stopRecorder() {
  if (state.recorder && state.recorder.state !== 'inactive') {
    try { state.recorder.stop(); } catch (error) {}
  }
}

function stopMicStream() {
  if (state.stream) {
    state.stream.getTracks().forEach(function(track) { track.stop(); });
    state.stream = null;
  }
}

function startRecognition() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    setMicStatus('Speech recognition is unavailable; audio capture will still be sent.');
    return;
  }

  const recognition = new Recognition();
  recognition.lang = 'en-US';
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onresult = function(event) {
    let finalText = '';
    let interimText = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalText += transcript + ' ';
      else interimText += transcript + ' ';
    }
    const combined = [state.transcript, finalText].join(' ').trim();
    state.transcript = combined || state.transcript;
    transcriptEl.textContent = (state.transcript || interimText.trim() || 'Listening…').trim();
    scheduleFinalize();
  };

  recognition.onerror = function(event) {
    const errorName = event && event.error ? event.error : 'unknown';
    if (errorName === 'not-allowed' || errorName === 'service-not-allowed') {
      setMicStatus('Microphone permission blocked. Enable it in browser settings.');
    } else {
      setMicStatus('Speech recognition is not available right now.');
    }
  };

  recognition.onend = function() {
    if (state.active && !state.busy) {
      scheduleFinalize();
    }
  };

  state.recognition = recognition;
  try { recognition.start(); } catch (error) {}
}

async function beginCycle() {
  if (!state.active || state.busy) return;
  if (!setSecureState()) return;

  state.loopToken += 1;
  const token = state.loopToken;
  hud.classList.add('recording');
  orbButton.setAttribute('aria-pressed', 'true');
  setLoopState('Continuous listening active. Tap orb to stop.');
  setMicStatus('Requesting microphone access…');
  setTransportStatus('Preparing voice relay…', true);
  transcriptEl.textContent = 'Listening…';
  state.transcript = '';
  state.chunks = [];
  clearSilenceTimer();

  try {
    await ensureMicrophone();
    await primeAudio();
    setMicStatus('Microphone live. Speak naturally.');

    const preferredMime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    state.recorderMime = preferredMime;
    state.recorder = new MediaRecorder(state.stream, { mimeType: preferredMime });
    state.recorder.ondataavailable = function(event) {
      if (event.data && event.data.size > 0) state.chunks.push(event.data);
    };
    state.recorder.start(220);
    startRecognition();

    if (token !== state.loopToken) return;
    state.listening = true;
  } catch (error) {
    stopRecognition();
    stopMicStream();
    state.active = false;
    state.listening = false;
    hud.classList.remove('recording');
    orbButton.setAttribute('aria-pressed', 'false');
    const message = error instanceof Error ? error.message : 'Unable to access microphone.';
    setMicStatus(message);
    setLoopState('Tap orb to start continuous listening mode.');
    setTransportStatus('Voice relay idle', true);
    addMessage('assistant', message);
  }
}

function blobToDataUrl(blob) {
  return new Promise(function(resolve, reject) {
    const reader = new FileReader();
    reader.onloadend = function() { resolve(String(reader.result || '')); };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function transmitVoicePacket(payload) {
  const response = await fetch('/api/voice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Voice relay request failed.');
  }
  return data;
}

function normalizeAudioSource(payload) {
  const audio = payload && (payload.audio || payload.audioUrl || payload.ttsAudio || payload.speechAudio);
  if (!audio || typeof audio !== 'string') return null;
  if (audio.startsWith('data:') || audio.startsWith('blob:') || audio.startsWith('http')) return audio;
  const mime = payload && payload.audioMimeType ? payload.audioMimeType : 'audio/webm';
  return 'data:' + mime + ';base64,' + audio;
}

function speakText(text) {
  if (!text || !('speechSynthesis' in window)) return Promise.resolve();
  window.speechSynthesis.cancel();
  return new Promise(function(resolve) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 0.98;
    utterance.volume = 1;
    utterance.onend = function() { resolve(); };
    utterance.onerror = function() { resolve(); };
    window.speechSynthesis.speak(utterance);
  });
}

async function playReply(payload) {
  const audioSource = normalizeAudioSource(payload);
  const replyText = String(payload.reply || payload.response || payload.tts || payload.message || '').trim();
  await primeAudio();

  if (audioSource) {
    try {
      await new Promise(function(resolve, reject) {
        const audio = new Audio(audioSource);
        audio.autoplay = true;
        audio.onended = function() { resolve(); };
        audio.onerror = function() { reject(new Error('Audio playback failed.')); };
        const playPromise = audio.play();
        if (playPromise && typeof playPromise.then === 'function') {
          playPromise.catch(reject);
        }
      });
      if (replyText) addMessage('assistant', replyText);
      return;
    } catch (error) {}
  }

  if (replyText) {
    await speakText(replyText);
    addMessage('assistant', replyText);
    return;
  }

  const fallback = 'Voice relay received the transcript.';
  await speakText(fallback);
  addMessage('assistant', fallback);
}

async function finalizeUtterance() {
  if (!state.active || state.busy) return;
  state.busy = true;
  clearSilenceTimer();
  setMicStatus('Sending transcript and audio…');
  setTransportStatus('Posting to Poke webhook…', true);

  const currentTranscript = (state.transcript || transcriptEl.textContent || '').trim();
  const recorder = state.recorder;
  const stopPromise = recorder ? new Promise(function(resolve) { recorder.addEventListener('stop', resolve, { once: true }); }) : Promise.resolve();

  if (recorder && recorder.state !== 'inactive') {
    try { recorder.stop(); } catch (error) {}
  }
  state.recorder = null;
  stopRecognition();

  await stopPromise;

  let audio = '';
  if (state.chunks.length) {
    try {
      const blob = new Blob(state.chunks, { type: state.recorderMime || 'audio/webm' });
      audio = await blobToDataUrl(blob);
    } catch (error) {
      audio = '';
    }
  }

  const payload = {
    triggerId: VOICE_TRIGGER_ID,
    transcript: currentTranscript,
    mimeType: state.recorderMime || 'audio/webm',
    audio: audio,
    source: 'cortana-web',
  };

  if (currentTranscript) addMessage('user', currentTranscript);

  try {
    const data = await transmitVoicePacket(payload);
    setTransportStatus('Poke webhook acknowledged', false);
    const reply = String(data.reply || data.response || data.tts || '').trim();
    if (reply || data.audio || data.audioUrl || data.ttsAudio || data.speechAudio) {
      await playReply(data);
    } else {
      const fallback = currentTranscript ? 'Heard: ' + currentTranscript : 'Voice packet delivered.';
      await speakText(fallback);
      addMessage('assistant', fallback);
    }
    transcriptEl.textContent = reply || currentTranscript || 'Idle.';
    setMicStatus('Ready for the next turn.');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Voice relay failed.';
    setTransportStatus('Voice relay error', true);
    setMicStatus(message);
    addMessage('assistant', message);
    transcriptEl.textContent = currentTranscript || 'Idle.';
  } finally {
    state.busy = false;
    state.chunks = [];
    state.transcript = '';
    if (state.active) {
      setTimeout(function() { if (state.active) beginCycle(); }, 160);
    }
  }
}

async function stopLoop() {
  state.active = false;
  state.busy = false;
  state.listening = false;
  clearSilenceTimer();
  hud.classList.remove('recording');
  orbButton.setAttribute('aria-pressed', 'false');
  setLoopState('Continuous listening stopped. Tap orb to start again.');
  setTransportStatus('Voice relay idle', true);
  setMicStatus('Microphone released.');
  transcriptEl.textContent = 'Idle.';
  stopRecognition();
  stopRecorder();
  stopMicStream();
  if (state.audioContext && state.audioContext.state === 'running') {
    try { await state.audioContext.suspend(); } catch (error) {}
  }
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

async function toggleLoop() {
  if (state.active) {
    await stopLoop();
    return;
  }
  state.active = true;
  state.busy = false;
  addMessage('system', 'Continuous mode on. Speak naturally and pause to send.');
  await beginCycle();
}

async function refreshPermissionLabel() {
  const permission = await queryMicPermission();
  if (permission === 'denied') setMicStatus('Microphone permission is blocked. Enable it in browser settings.');
  else if (permission === 'prompt') setMicStatus('Tap the orb to grant microphone access.');
  else if (permission === 'granted') setMicStatus('Microphone permission ready.');
}

function init() {
  if (!setSecureState()) return;
  orbButton.addEventListener('click', function() { toggleLoop(); });
  refreshPermissionLabel();
  setLoopState('Tap the orb to enter continuous listening mode.');
  addMessage('assistant', 'Tap the orb once to start a continuous listening and response loop. Tap again to stop.');
}

init();
