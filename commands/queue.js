module.exports = async function (message, serverQueue) {
    const queueConstruct = serverQueue.get(message.guild.id);

    if (!queueConstruct || queueConstruct.songs.length === 0) {
        return message.channel.send('ℹ️ The queue is currently empty.');
    }

    const MAX_CHARS = 1900;
    let messagesToSend = [];
    let currentMessage = '🎶 **Current Music Queue:**\n';

    for (let i = 0; i < queueConstruct.songs.length; i++) {
        const song = queueConstruct.songs[i];
        const line = `${i === 0 ? '▶️ **(Now Playing)**' : `${i + 1}.`} ${song.title} (${song.duration || 'N/A'})\n`;

        if (currentMessage.length + line.length > MAX_CHARS) {
            messagesToSend.push(currentMessage);
            currentMessage = '🎶 **Current Music Queue (continued):**\n' + line;
        } else {
            currentMessage += line;
        }
    }
    messagesToSend.push(currentMessage);

    let loopStatusString;
    switch (queueConstruct.loop) {
        case 'none':
            loopStatusString = 'Disabled';
            break;
        case 'single':
            loopStatusString = 'Enabled (Single Song)';
            break;
        case 'all':
            loopStatusString = 'Enabled (Full Queue)';
            break;
        default:
            loopStatusString = 'Unknown';
    }

    messagesToSend[messagesToSend.length - 1] += `\n🔁 Looping: **${loopStatusString}**`;

    for (const msg of messagesToSend) {
        await message.channel.send(msg);
    }
};
