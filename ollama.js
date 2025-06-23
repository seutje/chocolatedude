const { createChunkSender } = require('./chunkedSender');

module.exports = async function streamOllamaResponse(message, { model, prompt, images = [], options } = {}) {
    const baseUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
    const body = { model, prompt, stream: true };
    if (images.length) body.images = images;
    if (options) body.options = options;

    const response = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    if (!response.body) {
        throw new Error('No response body received');
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let jsonBuffer = '';
    const sendChunk = createChunkSender(message.channel);

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        jsonBuffer += decoder.decode(value, { stream: true });
        const lines = jsonBuffer.split('\n');
        jsonBuffer = lines.pop();
        for (const line of lines) {
            if (!line.trim()) continue;
            const data = JSON.parse(line);
            if (data.done) {
                await sendChunk('', true);
            } else if (data.response) {
                await sendChunk(data.response);
            }
        }
    }
    if (jsonBuffer.trim()) {
        const data = JSON.parse(jsonBuffer);
        if (data.response) {
            await sendChunk(data.response);
        }
    }
    await sendChunk('', true);
};

module.exports.chat = async function streamOllamaChat(message, { model, messages, options } = {}) {
    const baseUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
    const body = { model, messages, stream: true };
    if (options) body.options = options;

    const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    if (!response.body) {
        throw new Error('No response body received');
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let jsonBuffer = '';
    let fullText = '';
    const sendChunk = createChunkSender(message.channel);

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        jsonBuffer += decoder.decode(value, { stream: true });
        const lines = jsonBuffer.split('\n');
        jsonBuffer = lines.pop();
        for (const line of lines) {
            if (!line.trim()) continue;
            const data = JSON.parse(line);
            if (data.done) {
                await sendChunk('', true);
            } else if (data.message && data.message.content) {
                await sendChunk(data.message.content);
                fullText += data.message.content;
            }
        }
    }
    if (jsonBuffer.trim()) {
        const data = JSON.parse(jsonBuffer);
        if (data.message && data.message.content) {
            await sendChunk(data.message.content);
            fullText += data.message.content;
        }
    }
    await sendChunk('', true);
    return fullText;
};
