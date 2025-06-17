module.exports = function (message, serverQueue) {
    const queueConstruct = serverQueue.get(message.guild.id);

    if (!queueConstruct || queueConstruct.songs.length <= 1) {
        return message.channel.send('❌ Not enough songs in the queue to shuffle!');
    }
    if (!message.member.voice.channel || message.member.voice.channel.id !== queueConstruct.voiceChannel.id) {
        return message.channel.send('❌ You must be in the same voice channel as the bot to shuffle music!');
    }

    const currentSong = queueConstruct.songs.shift();

    let currentIndex = queueConstruct.songs.length;
    let randomIndex;

    while (currentIndex !== 0) {
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;
        [queueConstruct.songs[currentIndex], queueConstruct.songs[randomIndex]] = [
            queueConstruct.songs[randomIndex],
            queueConstruct.songs[currentIndex],
        ];
    }

    queueConstruct.songs.unshift(currentSong);
    message.channel.send('🔀 Queue has been shuffled!');
};
