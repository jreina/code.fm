import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createRequire } from "module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { config } from "dotenv";

config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const ACE_API = process.env.ACE_API || "http://localhost:8008";
const ACE_TOKEN = process.env.ACE_TOKEN || "";

const CACHE_DIR = join(__dirname, "cache");
const AUDIO_DIR = join(CACHE_DIR, "audio");
const META_FILE = join(CACHE_DIR, "tracks.json");

mkdirSync(AUDIO_DIR, { recursive: true });

// Track metadata persistence
function loadTracks() {
  if (!existsSync(META_FILE)) return [];
  try { return JSON.parse(readFileSync(META_FILE, "utf-8")); }
  catch { return []; }
}

function saveTracks(tracks) {
  writeFileSync(META_FILE, JSON.stringify(tracks, null, 2));
}

// In-memory track list, seeded from disk
const trackList = loadTracks();

// Download and cache audio file from ACE API, returns local filename
async function cacheAudio(taskId, remotePath) {
  const filename = `${taskId}.mp3`;
  const localPath = join(AUDIO_DIR, filename);
  if (existsSync(localPath)) return filename;
  const url = `${ACE_API}/v1/audio?path=${encodeURIComponent(remotePath)}`;
  const resp = await fetch(url, { headers: aceHeaders() });
  if (!resp.ok) throw new Error(`Audio download failed: ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  writeFileSync(localPath, buf);
  return filename;
}

app.use(express.json());
app.use(express.static(join(__dirname, "public")));

const require = createRequire(import.meta.url);
const PROMPTS = require("./prompts.json");

function pickPrompt() {
  return PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
}

function aceHeaders() {
  const h = { "Content-Type": "application/json" };
  if (ACE_TOKEN) h["Authorization"] = `Bearer ${ACE_TOKEN}`;
  return h;
}

// Return cached track library
app.get("/api/tracks", (_req, res) => {
  res.json(trackList);
});

// Submit a generation task
app.post("/api/generate", async (_req, res) => {
  const p = pickPrompt();
  try {
    const resp = await fetch(`${ACE_API}/release_task`, {
      method: "POST",
      headers: aceHeaders(),
      body: JSON.stringify({
        prompt: p.prompt,
        lyrics: "[inst]",
        audio_format: "mp3",
        inference_steps: 40,
        batch_size: 1,
        bpm: p.bpm,
        key_scale: p.key_scale,
        audio_duration: p.audio_duration,
        time_signature: 4,
        thinking: true,
      }),
    });
    const data = await resp.json();
    const taskId = data.data?.task_id;
    const track = {
      taskId,
      prompt: p.prompt,
      status: "generating",
      audioFile: null,
    };
    trackList.push(track);
    saveTracks(trackList);
    res.json({ taskId, promptUsed: p.prompt });
  } catch (err) {
    console.error("Generate error:", err);
    res.status(502).json({ error: "Failed to reach ACE-Step API" });
  }
});

// Parse ACE-Step query_result response into a taskId -> parsed map
function parseAceResults(data) {
  const results = {};
  // data.data is an array of { task_id, result (JSON string), status }
  const items = Array.isArray(data?.data) ? data.data : [];
  for (const item of items) {
    let parsed = null;
    try {
      const arr = JSON.parse(item.result);
      parsed = Array.isArray(arr) ? arr[0] : arr;
    } catch {}
    results[item.task_id] = {
      status: item.status,
      parsed,
    };
  }
  return results;
}

// Poll task status — caches audio on completion
app.post("/api/status", async (req, res) => {
  const { taskIds } = req.body;
  try {
    const resp = await fetch(`${ACE_API}/query_result`, {
      method: "POST",
      headers: aceHeaders(),
      body: JSON.stringify({ task_id_list: taskIds }),
    });
    const raw = await resp.json();
    const taskResults = parseAceResults(raw);

    // Cache completed tracks
    for (const taskId of taskIds) {
      const r = taskResults[taskId];
      if (!r || r.status !== 1 || !r.parsed) continue;
      // The file field is a URL path like "/v1/audio?path=..."
      const fileUrl = r.parsed.file;
      if (!fileUrl) continue;
      const track = trackList.find(t => t.taskId === taskId);
      if (!track || track.status === "ready") continue;
      try {
        // Extract the path param from the file URL
        const match = fileUrl.match(/[?&]path=([^&]+)/);
        const remotePath = match ? decodeURIComponent(match[1]) : fileUrl;
        const audioFile = await cacheAudio(taskId, remotePath);
        track.status = "ready";
        track.audioFile = audioFile;
        saveTracks(trackList);
        console.log(`Cached track ${taskId} -> ${audioFile}`);
      } catch (err) {
        console.error(`Failed to cache audio for ${taskId}:`, err);
      }
    }

    // Mark failures
    for (const taskId of taskIds) {
      const r = taskResults[taskId];
      if (r?.status === 2) {
        const track = trackList.find(t => t.taskId === taskId);
        if (track && track.status !== "failed") {
          track.status = "failed";
          saveTracks(trackList);
        }
      }
    }

    // Return normalized format to frontend
    res.json({ tasks: taskResults });
  } catch (err) {
    console.error("Status error:", err);
    res.status(502).json({ error: "Failed to reach ACE-Step API" });
  }
});

// Serve cached audio files
app.get("/api/audio/:filename", (req, res) => {
  const filename = req.params.filename;
  // Prevent path traversal
  if (filename.includes("/") || filename.includes("..")) {
    return res.status(400).send("Invalid filename");
  }
  const filePath = join(AUDIO_DIR, filename);
  if (!existsSync(filePath)) return res.status(404).send("Not found");
  res.set("Content-Type", "audio/mpeg");
  res.sendFile(filePath);
});

app.listen(PORT, () => {
  console.log(`code.fm running at http://localhost:${PORT}`);
  console.log(`ACE-Step API: ${ACE_API}`);
});
