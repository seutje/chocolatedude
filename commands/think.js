const streamOllama = require('../ollama');
const queue = require('../commandLock');

module.exports = async function (message) {
    const args = message.content.split(' ').slice(1);
    const prompt = args.join(' ');

    if (!prompt) {
        return message.channel.send('❌ Please provide a prompt for the think command.');
    }

    const label = `!think by ${message.author.username}`;
    const ahead = queue.enqueue(label, async () => {
        await message.channel.send('Let me think... (using qwen3:14b)');
        try {
            await streamOllama(message, { model: 'qwen3:14b', prompt, options: { think: true } });
        } catch (error) {
            console.error('Error during !think command:', error);
            message.channel.send('❌ Failed to get a response from the Ollama API.');
        }
    });

    if (ahead === false) {
        return message.channel.send('❌ The waiting list is full. Please try again later.');
    }
    if (ahead > 0) {
        message.channel.send(`⌛ Added to waiting list. There are ${ahead} request(s) ahead of you.`);
    }
};
