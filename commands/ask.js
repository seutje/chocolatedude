module.exports = async function (message) {
    const args = message.content.split(' ').slice(1);
    const prompt = args.join(' ');

    const images = [];
    for (const attachment of message.attachments.values()) {
        if (attachment.contentType?.startsWith('image/') || attachment.height) {
            try {
                const res = await fetch(attachment.url);
                if (res.ok) {
                    const buf = Buffer.from(await res.arrayBuffer());
                    images.push(buf.toString('base64'));
                } else {
                    console.warn('Failed to fetch attachment:', res.status);
                }
            } catch (err) {
                console.warn('Error fetching attachment', err);
            }
        }
    }

    if (!prompt) {
        return message.channel.send('❌ Please provide a prompt for the ask command.');
    }

    // Let users know the bot is thinking before reaching out to the API
    await message.channel.send('Let me think... (using gemma3:12b-it-qat)');

    try {
        const baseUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
        const body = { model: 'gemma3:12b-it-qat', prompt, stream: true };
        if (images.length) body.images = images;
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

        const decoder = new TextDecoder();
        const reader = response.body.getReader();
        let jsonBuffer = '';
        let textBuffer = '';
        let leftoverTag = '';
        let prefix = '';
        let inThink = false;
        let thinkBuffer = '';

        const isTagPrefix = (str) => '<think>'.startsWith(str) || '</think>'.startsWith(str);

        function transformChunk(chunk) {
            chunk = leftoverTag + chunk;
            leftoverTag = '';
            let result = '';
            for (let i = 0; i < chunk.length;) {
                if (!inThink && chunk.startsWith('<think>', i)) {
                    inThink = true;
                    i += 7;
                    continue;
                }
                if (inThink && chunk.startsWith('</think>', i)) {
                    inThink = false;
                    i += 8;
                    result += `🤔 ${thinkBuffer.trim()} 🤔`;
                    thinkBuffer = '';
                    continue;
                }
                if (chunk[i] === '<') {
                    const remaining = chunk.slice(i);
                    if ((!inThink && isTagPrefix(remaining)) || (inThink && '</think>'.startsWith(remaining))) {
                        leftoverTag = remaining;
                        break;
                    }
                }
                if (inThink) {
                    thinkBuffer += chunk[i];
                } else {
                    result += chunk[i];
                }
                i++;
            }
            return result;
        }

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
                    textBuffer += transformChunk('');
                    await flushChunks(true);
                } else if (data.response) {
                    textBuffer += transformChunk(data.response);
                    await flushChunks();
                }
            }
        }
        if (jsonBuffer.trim()) {
            const data = JSON.parse(jsonBuffer);
            if (data.response) {
                textBuffer += transformChunk(data.response);
            }
        }
        await flushChunks(true);
    } catch (error) {
        console.error('Error during !ask command:', error);
        message.channel.send('❌ Failed to get a response from the Ollama API.');
    }
};
