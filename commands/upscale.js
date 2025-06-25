const { fetch, Agent } = require('undici');
const queue = require('../commandLock');

module.exports = async function (message) {
    const imageAttachment = [...message.attachments.values()].find(att => att.contentType?.startsWith('image/') || att.height);

    if (!imageAttachment) {
        return message.channel.send('❌ Please attach an image to upscale.');
    }

    let imageBase64;
    try {
        const res = await fetch(imageAttachment.url);
        if (!res.ok) {
            throw new Error(`Failed to fetch attachment: HTTP ${res.status}`);
        }
        const buf = Buffer.from(await res.arrayBuffer());
        imageBase64 = buf.toString('base64');
    } catch (err) {
        console.error('Error fetching attachment', err);
        return message.channel.send('❌ Failed to fetch the attached image.');
    }

    const label = `!upscale by ${message.author.username}`;
    const ahead = queue.enqueue(label, async () => {
        await message.channel.send('⏳ Upscaling image, please wait...');

        const apiUrl = process.env.UPSCALE_URL || 'http://172.20.80.1:5000/upscale';
        try {
            const agent = new Agent({ headersTimeout: 20 * 60 * 1000 });
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image_base64: imageBase64 }),
                dispatcher: agent
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const result = await response.json();
            if (!result.image_base64) {
                throw new Error("Response missing 'image_base64'");
            }

            const buffer = Buffer.from(result.image_base64, 'base64');
            await message.channel.send({ files: [{ attachment: buffer, name: 'upscaled.png' }] });
        } catch (error) {
            console.error('Error during !upscale command:', error);
            message.channel.send('❌ Failed to upscale the image.');
        }
    });

    if (ahead === false) {
        return message.channel.send('❌ The waiting list is full. Please try again later.');
    }
    if (ahead > 0) {
        message.channel.send(`⌛ Added to waiting list. There are ${ahead} request(s) ahead of you.`);
    }
};
