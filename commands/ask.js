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
        const body = { model: 'gemma3:12b-it-qat', prompt, stream: false };
        if (images.length) body.images = images;
        const response = await fetch(`${baseUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        let answer = data.response || data.message || 'No response';
        // Replace <think> blocks with 🤔 emoji and italics, removing empty blocks
        answer = answer.replace(/<think>([\s\S]*?)<\/think>/gi, (_, text) => {
            const trimmed = text.trim();
            return trimmed ? `🤔 *${trimmed}*` : '';
        });

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

        // Split long responses while keeping markdown formatting intact.
        // Default chunk size is 1750 characters to stay well below
        // Discord's 2000 character limit.
        function splitResponse(text, maxLen = 1750) {
            const chunks = [];
            let prefix = '';
            while (text.length) {
                let part = text.slice(0, maxLen);
                if (text.length > maxLen) {
                    let splitPos = Math.max(part.lastIndexOf('\n'), part.lastIndexOf(' '));
                    if (splitPos <= 0) splitPos = maxLen;
                    part = text.slice(0, splitPos);
                }
                const chunk = prefix + part;
                const unclosed = computeUnclosed(chunk);
                const closing = unclosed.slice().reverse().join('');
                chunks.push(chunk + closing);
                prefix = unclosed.join('');
                text = text.slice(part.length);
            }
            return chunks;
        }

        for (const part of splitResponse(answer)) {
            await message.channel.send(part.trimStart());
        }
    } catch (error) {
        console.error('Error during !ask command:', error);
        message.channel.send('❌ Failed to get a response from the Ollama API.');
    }
};
