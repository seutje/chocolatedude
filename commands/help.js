module.exports = function (message) {
    const helpMessage = [
        '**Available Commands:**',
        '!play <url or search> - play a YouTube video, playlist or Spotify track/playlist.',
        '!skip - skip the current song.',
        '!pause - pause playback.',
        '!resume - resume if paused.',
        '!stop - stop and leave the voice channel.',
        '!loop [single|all] - cycle looping modes for one song or the whole queue.',
        '!queue - display the current queue.',
        '!search <terms> - show top YouTube results.',
        '!shuffle - shuffle upcoming songs.',
        '!remove <position> - remove a song by its number in the queue.',
        '!ask <prompt> - ask a question using the local Ollama API. Attach images to include them with the prompt.',
        '!image <prompt> - generate an image using the API at DIFFUSION_URL.',
        '!listen - record a short voice message and execute the spoken command (e.g. play, skip, image).',
        '!help - show this message.'
    ].join('\n');

    message.channel.send(helpMessage);
};
