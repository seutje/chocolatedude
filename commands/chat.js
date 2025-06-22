const streamOllama = require('../ollama');

// Track chat history per channel so conversations have context
// Only the last MAX_HISTORY messages are kept per channel
const histories = new Map();
const MAX_HISTORY = parseInt(process.env.CHAT_HISTORY_LIMIT || '50', 10); // configurable via env

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
        return message.channel.send('❌ Please provide a prompt for the chat command.');
    }

    await message.channel.send('Let me think... (using gemma3:12b-it-qat)');

    try {
        const history = histories.get(message.channel.id) || [];
        const userMsg = { role: 'user', content: prompt };
        if (images.length) userMsg.images = images;
        history.push(userMsg);

        const reply = await streamOllama.chat(message, { model: 'gemma3:12b-it-qat', messages: history });

        history.push({ role: 'assistant', content: reply });
        histories.set(message.channel.id, history.slice(-MAX_HISTORY));
    } catch (error) {
        console.error('Error during !chat command:', error);
        message.channel.send('❌ Failed to get a response from the Ollama API.');
    }
};
