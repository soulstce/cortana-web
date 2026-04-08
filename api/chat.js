module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const payload = req.body && typeof req.body === 'object' ? req.body : {};
  const message = String(payload.message || '').trim();

  if (!message) {
    return res.status(400).json({ error: 'Message is required.' });
  }

  return res.status(200).json({
    reply: 'Cortana is live. Received: ' + message,
    source: 'api/chat.js'
  });
};
