module.exports = function (message, serverQueue) {
    const queueConstruct = serverQueue.get(message.guild.id);
    const args = message.content.split(' ');
    const loopType = args[1] ? args[1].toLowerCase() : null;

    if (!queueConstruct || !queueConstruct.songs.length) {
        return message.channel.send('❌ There is no song currently playing to loop!');
    }
    if (!message.member.voice.channel || message.member.voice.channel.id !== queueConstruct.voiceChannel.id) {
        return message.channel.send('❌ You must be in the same voice channel as the bot to toggle looping!');
    }

    if (loopType === 'all') {
        queueConstruct.loop = 'all';
        message.channel.send('🔁 Looping: **Entire queue** is now enabled.');
    } else if (loopType === 'single') {
        queueConstruct.loop = 'single';
        message.channel.send('🔁 Looping: **Single song** is now enabled.');
    } else {
        switch (queueConstruct.loop) {
            case 'none':
                queueConstruct.loop = 'single';
                message.channel.send('🔁 Looping: **Single song** is now enabled.');
                break;
            case 'single':
                queueConstruct.loop = 'all';
                message.channel.send('🔁 Looping: **Entire queue** is now enabled.');
                break;
            case 'all':
                queueConstruct.loop = 'none';
                message.channel.send('🔁 Looping: **Disabled**.');
                break;
        }
    }
};
