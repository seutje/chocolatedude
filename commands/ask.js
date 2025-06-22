const streamOllama = require('../ollama');
const lock = require('../commandLock');

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

    if (!lock.acquire()) {
        return message.channel.send('❌ Another request is already in progress. Please wait for it to finish.');
    }

    // Let users know the bot is thinking before reaching out to the API
    await message.channel.send('Let me think... (using gemma3:12b-it-qat)');

    try {
        await streamOllama(message, { model: 'gemma3:12b-it-qat', prompt, images });
    } catch (error) {
        console.error('Error during !ask command:', error);
        message.channel.send('❌ Failed to get a response from the Ollama API.');
    } finally {
        lock.release();
    }
};
