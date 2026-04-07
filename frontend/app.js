const messageInput = document.getElementById('message');
const sendButton = document.getElementById('sendButton');
const response = document.getElementById('response');

async function sendMessage() {
  const message = messageInput.value.trim();

  if (!message) {
    response.textContent = 'Enter a message to continue.';
    return;
  }

  response.textContent = 'Sending…';

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Something went wrong.');
    }

    response.textContent = data.reply;
  } catch (error) {
    response.textContent = error instanceof Error ? error.message : 'Unexpected error.';
  }
}

sendButton.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    sendMessage();
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/frontend/sw.js').catch(() => {});
  });
}
