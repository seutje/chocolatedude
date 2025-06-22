const streamOllama = require('../ollama');
const { getContext, setContext } = require('../contextStore');

module.exports = async function (message) {
    const args = message.content.split(' ').slice(1);
    const prompt = args.join(' ');

    if (!prompt) {
        return message.channel.send('❌ Please provide a prompt for the think command.');
    }

    // Let users know the bot is thinking before reaching out to the API
    await message.channel.send('Let me think... (using qwen3:14b)');

    try {
        const context = getContext(message.author.id);
        const newContext = await streamOllama(message, { model: 'qwen3:14b', prompt, options: { think: true }, context });
        setContext(message.author.id, newContext);
    } catch (error) {
        console.error('Error during !think command:', error);
        message.channel.send('❌ Failed to get a response from the Ollama API.');
    }
};
