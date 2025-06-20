module.exports = async function (message) {
    const args = message.content.split(' ').slice(1);
    const prompt = args.join(' ');

    if (!prompt) {
        return message.channel.send('❌ Please provide a prompt for the ask command.');
    }

    // Let users know the bot is thinking before reaching out to the API
    await message.channel.send('Let me think... (using deepseek-r1:7b)');

    try {
        const baseUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
        const response = await fetch(`${baseUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'deepseek-r1:7b', prompt, stream: false })
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

        function splitResponse(text, maxLen = 2000) {
            const chunks = [];
            while (text.length) {
                let chunk = text.slice(0, maxLen);
                if (text.length > maxLen) {
                    let splitPos = Math.max(chunk.lastIndexOf('\n'), chunk.lastIndexOf(' '));
                    if (splitPos <= 0) splitPos = maxLen;
                    chunk = text.slice(0, splitPos);
                }
                const starCount = (chunk.match(/\*/g) || []).length;
                if (starCount % 2) {
                    chunk += '*';
                    text = '*' + text.slice(chunk.length - 1);
                } else {
                    text = text.slice(chunk.length);
                }
                chunks.push(chunk);
            }
            return chunks;
        }

        for (const part of splitResponse(answer)) {
            await message.channel.send(part);
        }
    } catch (error) {
        console.error('Error during !ask command:', error);
        message.channel.send('❌ Failed to get a response from the Ollama API.');
    }
};
