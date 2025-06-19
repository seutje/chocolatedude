# ChocolateDude Discord Bot

ChocolateDude is a Discord music bot written in Node.js. It can play music from YouTube or Spotify links, manage queues and understand voice commands using OpenAI's Whisper.

## Requirements

- Node.js 18 or later
- `ffmpeg` in your system path (used for audio processing)
- A Discord bot token stored in a `.env` file as `DISCORD_TOKEN`

The bot relies on the [`nodejs-whisper`](https://www.npmjs.com/package/nodejs-whisper) package which wraps OpenAI's Whisper model. The Whisper model files will be downloaded automatically on first use.

Install dependencies with:

```bash
npm install
```

## Usage

Start the bot with:

```bash
node index.js
```

## Commands

Text commands are prefixed with `!`:

- `!play <url or search>` – play a YouTube video, playlist or Spotify track/playlist.
- `!skip` – skip the current song.
- `!pause` – pause playback.
- `!resume` – resume if paused.
- `!stop` – stop and leave the voice channel.
- `!loop [single|all]` – cycle looping modes for one song or the whole queue.
- `!queue` – display the current queue.
- `!search <terms>` – show top YouTube results.
- `!shuffle` – shuffle upcoming songs.
- `!remove <position>` – remove a song by its number in the queue.
- `!listen` – record a short voice message. The bot transcribes it with Whisper and executes the spoken command (e.g. "play", "skip").

## Testing

Run the unit tests with:

```bash
npm test
```


