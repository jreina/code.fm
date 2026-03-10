# code.fm

Infinite AI-generated focus music for coding. Tracks are generated on-the-fly using an [ACE-Step](https://github.com/ace-step/ACE-Step-1.5) API, creating a never-ending playlist of instrumental music.

<img width="681" height="857" alt="image" src="https://github.com/user-attachments/assets/16b00bac-5895-42f2-bb0c-ab42f740b95b" />


## How it works

- Press play to generate your first track
- When the most recently generated track is ~45 seconds from ending, the next one is automatically queued for generation
- Browsing older tracks won't trigger new generations — only the latest track does
- Generated audio is cached locally so your library survives restarts

## Setup

```bash
npm install
```

Create a `.env` file (or export env vars):

```
ACE_API=http://<your-ace-step-host>:8008
ACE_TOKEN=              # optional, if your API requires auth
PORT=3000               # optional, defaults to 3000
```

## Usage

```bash
npm start
```

Open `http://localhost:3000`.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| Space | Play / Pause |
| Arrow Left | Previous track |
| Arrow Right | Next track |
| Arrow Up | Volume up |
| Arrow Down | Volume down |
| M | Mute / Unmute |

## Customizing prompts

Edit `prompts.json` to change the music styles. Each entry has:

```json
{
  "prompt": "genre tags and descriptors",
  "bpm": 85,
  "key_scale": "C Minor",
  "audio_duration": 180
}
```

## Built with Claude

This project was generated with [Claude Code](https://claude.ai) (Anthropic's Claude). The code, structure, and this README were all written by Claude.

## Project structure

```
server.js          Express server, proxies ACE-Step API, caches audio
prompts.json       Music generation prompt pool
public/
  index.html       Page markup
  style.css        Styles
  app.js           Client-side player logic
cache/
  tracks.json      Persisted track metadata
  audio/           Cached mp3 files
```
