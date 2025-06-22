function computeUnclosed(str) {
    const stack = [];
    const re = /(\*{1,3})/g; // handle only asterisks, ignore underscores
    let m;
    while ((m = re.exec(str)) !== null) {
        const token = m[1];
        if (stack.length && stack[stack.length - 1] === token) {
            stack.pop();
        } else {
            stack.push(token);
        }
    }
    return stack;
}

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
    let textBuffer = '';
    let prefix = '';

    async function flushChunks(force = false) {
        while (textBuffer.length >= 1750 || (force && textBuffer.length)) {
            let part = textBuffer.slice(0, 1750);
            if (textBuffer.length > 1750) {
                let splitPos = Math.max(part.lastIndexOf('\n'), part.lastIndexOf(' '));
                if (splitPos <= 0) splitPos = 1750;
                part = textBuffer.slice(0, splitPos);
            }
            const chunk = prefix + part;
            const unclosed = computeUnclosed(chunk);
            const closing = unclosed.slice().reverse().join('');
            await message.channel.send((chunk + closing).trimStart());
            prefix = unclosed.join('');
            textBuffer = textBuffer.slice(part.length);
        }
    }

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
                await flushChunks(true);
            } else if (data.response) {
                textBuffer += data.response;
                await flushChunks();
            }
        }
    }
    if (jsonBuffer.trim()) {
        const data = JSON.parse(jsonBuffer);
        if (data.response) {
            textBuffer += data.response;
        }
    }
    await flushChunks(true);
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
    let textBuffer = '';
    let prefix = '';

    async function flushChunks(force = false) {
        while (textBuffer.length >= 1750 || (force && textBuffer.length)) {
            let part = textBuffer.slice(0, 1750);
            if (textBuffer.length > 1750) {
                let splitPos = Math.max(part.lastIndexOf('\n'), part.lastIndexOf(' '));
                if (splitPos <= 0) splitPos = 1750;
                part = textBuffer.slice(0, splitPos);
            }
            const chunk = prefix + part;
            const unclosed = computeUnclosed(chunk);
            const closing = unclosed.slice().reverse().join('');
            await message.channel.send((chunk + closing).trimStart());
            prefix = unclosed.join('');
            textBuffer = textBuffer.slice(part.length);
        }
    }

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
                await flushChunks(true);
            } else if (data.message && data.message.content) {
                textBuffer += data.message.content;
                await flushChunks();
            }
        }
    }
    if (jsonBuffer.trim()) {
        const data = JSON.parse(jsonBuffer);
        if (data.message && data.message.content) {
            textBuffer += data.message.content;
        }
    }
    await flushChunks(true);
};
