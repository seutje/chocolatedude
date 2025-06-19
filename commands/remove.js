module.exports = function (message, serverQueue) {
    const queueConstruct = serverQueue.get(message.guild.id);
    const args = message.content.split(' ').slice(1);

    const numberWords = {
        zero: 0,
        one: 1,
        two: 2,
        three: 3,
        four: 4,
        five: 5,
        six: 6,
        seven: 7,
        eight: 8,
        nine: 9,
        ten: 10,
        eleven: 11,
        twelve: 12,
        thirteen: 13,
        fourteen: 14,
        fifteen: 15,
        sixteen: 16,
        seventeen: 17,
        eighteen: 18,
        nineteen: 19,
        twenty: 20,
    };

    let firstArg = args[0] ? args[0].toLowerCase() : undefined;
    if (firstArg && numberWords.hasOwnProperty(firstArg)) {
        firstArg = String(numberWords[firstArg]);
        args[0] = firstArg;
    }
    const indexToRemove = parseInt(args[0]);

    if (!queueConstruct || queueConstruct.songs.length === 0) {
        return message.channel.send('❌ The queue is empty. Nothing to remove!');
    }
    if (!message.member.voice.channel || message.member.voice.channel.id !== queueConstruct.voiceChannel.id) {
        return message.channel.send('❌ You must be in the same voice channel as the bot to remove music!');
    }

    if (isNaN(indexToRemove) || indexToRemove < 1) {
        return message.channel.send('❌ Please provide a valid song number to remove (e.g., `!remove 2`).');
    }

    if (indexToRemove === 1) {
        if (queueConstruct.loop === 'single') {
            queueConstruct.loop = 'none';
            message.channel.send('🔁 Single song looping disabled due to skip.');
        }
        queueConstruct.player.stop();
        message.channel.send('🗑️ Skipped the current song.');
    } else {
        const actualIndex = indexToRemove - 1;

        if (actualIndex >= queueConstruct.songs.length) {
            return message.channel.send('❌ That song number does not exist in the queue.');
        }

        const removedSong = queueConstruct.songs.splice(actualIndex, 1);
        if (removedSong.length > 0) {
            message.channel.send(`🗑️ Removed **${removedSong[0].title}** from the queue.`);
        } else {
            message.channel.send('❌ Could not remove the song. Please try again.');
        }
    }
};
