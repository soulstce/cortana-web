const POKE_WEBHOOK_URL = 'https://poke.com/api/v1/inbound/webhook';
const POKE_WEBHOOK_TOKEN = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI4ZDk4OGM2Yi1jZGZjLTQ1ZjEtYTUwMS1kODc0Y2QzOTk4NzMiLCJqdGkiOiI4NmVlYjRiYS0wYjFiLTQzYWQtOTJlZC05MzE3ZGFmYjJmZTIiLCJpYXQiOjE3NzU2MTgyODQsImV4cCI6MjA5MDk3ODI4NH0.KRekg48svNAaGBmvTOjMd4TSFmMBr7WXQvsiLcETEvU';
const DEFAULT_TRIGGER_ID = '9b2309d7-cc85-4025-984c-1c872810feb3';

async function relayToPoke(payload) {
  const body = {
    triggerId: payload.triggerId || DEFAULT_TRIGGER_ID,
    transcript: payload.transcript || '',
    mimeType: payload.mimeType || 'audio/webm',
    audio: payload.audio || '',
    source: payload.source || 'cortana-web',
  };

  const response = await fetch(POKE_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': POKE_WEBHOOK_TOKEN,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    data = { reply: text };
  }

  if (!response.ok) {
    throw new Error(data.error || data.message || 'Poke webhook request failed.');
  }

  return data;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const payload = req.body && typeof req.body === 'object' ? req.body : {};
  const transcript = String(payload.transcript || '').trim();

  try {
    const data = await relayToPoke(payload);
    return res.status(200).json({
      ok: true,
      reply: data.response || data.reply || data.tts || transcript || 'Voice loop received.',
      raw: data,
    });
  } catch (error) {
    return res.status(200).json({
      ok: true,
      reply: transcript ? 'Cortana heard: ' + transcript : 'Voice loop received.',
      fallback: true,
      error: error instanceof Error ? error.message : 'Voice relay unavailable.',
    });
  }
};
