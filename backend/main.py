from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

@app.get('/api/health')
def health():
    return jsonify(status='ok', service='cortana-web-backend')

@app.post('/api/chat')
def chat():
    payload = request.get_json(silent=True) or {}
    message = (payload.get('message') or '').strip()

    if not message:
        return jsonify(error='Message is required.'), 400

    return jsonify(
        reply=f"Cortana Web received: {message}",
        source='backend/main.py'
    )

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
