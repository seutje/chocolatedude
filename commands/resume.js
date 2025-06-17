const { AudioPlayerStatus } = require('@discordjs/voice');

module.exports = function (message, serverQueue) {
    const queueConstruct = serverQueue.get(message.guild.id);
    if (!queueConstruct || queueConstruct.songs.length === 0) {
        return message.channel.send('❌ There is no music to resume!');
    }
    if (!message.member.voice.channel || message.member.voice.channel.id !== queueConstruct.voiceChannel.id) {
        return message.channel.send('❌ You must be in the same voice channel as the bot to resume music!');
    }

    if (queueConstruct.player.state.status === AudioPlayerStatus.Paused) {
        queueConstruct.player.unpause();
        message.channel.send('▶️ Music resumed.');
    } else {
        message.channel.send('❌ Music is not paused.');
    }
};
