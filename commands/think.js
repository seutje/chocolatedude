const streamOllama = require('../ollama');
const lock = require('../commandLock');

module.exports = async function (message) {
    const args = message.content.split(' ').slice(1);
    const prompt = args.join(' ');

    if (!prompt) {
        return message.channel.send('❌ Please provide a prompt for the think command.');
    }

    if (!lock.acquire()) {
        return message.channel.send('❌ Another request is already in progress. Please wait for it to finish.');
    }

    // Let users know the bot is thinking before reaching out to the API
    await message.channel.send('Let me think... (using qwen3:14b)');

    try {
        await streamOllama(message, { model: 'qwen3:14b', prompt, options: { think: true } });
    } catch (error) {
        console.error('Error during !think command:', error);
        message.channel.send('❌ Failed to get a response from the Ollama API.');
    } finally {
        lock.release();
    }
};
