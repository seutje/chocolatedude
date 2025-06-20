module.exports = async function (message) {
    const args = message.content.split(' ').slice(1);
    const prompt = args.join(' ');

    if (!prompt) {
        return message.channel.send('❌ Please provide a prompt for the ask command.');
    }

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
        const answer = data.response || data.message || 'No response';
        message.channel.send(answer);
    } catch (error) {
        console.error('Error during !ask command:', error);
        message.channel.send('❌ Failed to get a response from the Ollama API.');
    }
};
