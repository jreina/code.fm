const audio = document.getElementById("audio");
const btnPlay = document.getElementById("btnPlay");
const btnPrev = document.getElementById("btnPrev");
const btnNext = document.getElementById("btnNext");
const iconPlay = document.getElementById("iconPlay");
const iconPause = document.getElementById("iconPause");
const progressBar = document.getElementById("progressBar");
const progressFill = document.getElementById("progressFill");
const timeCurrent = document.getElementById("timeCurrent");
const timeTotal = document.getElementById("timeTotal");
const trackNumber = document.getElementById("trackNumber");
const trackPrompt = document.getElementById("trackPrompt");
const trackStatus = document.getElementById("trackStatus");
const vizRing = document.getElementById("vizRing");
const playlistEl = document.getElementById("playlist");
const volumeSlider = document.getElementById("volumeSlider");
const volumeIcon = document.getElementById("volumeIcon");
const volPath = document.getElementById("volPath");

// State
let tracks = [];        // { taskId, prompt, status: 'generating'|'ready'|'failed', audioFile }
let currentIndex = -1;
let isPlaying = false;
let generationTriggered = false;
let started = false;
const TRIGGER_SECONDS_BEFORE_END = 45;
let pollInterval = null;

// --- Helpers ---

function fmt(sec) {
  if (!sec || !isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function shortPrompt(prompt) {
  return prompt.split(",").slice(0, 4).join(", ");
}

// --- UI updates ---

function updatePlayButton() {
  iconPlay.style.display = isPlaying ? "none" : "";
  iconPause.style.display = isPlaying ? "" : "none";
  vizRing.classList.toggle("playing", isPlaying);
}

function updateNavButtons() {
  btnPrev.disabled = currentIndex <= 0;
  const nextReady = currentIndex < tracks.length - 1 && tracks[currentIndex + 1]?.status === "ready";
  btnNext.disabled = !nextReady;
}

function updateVizGenerating() {
  const anyGenerating = tracks.some(t => t.status === "generating");
  vizRing.classList.toggle("generating", anyGenerating);
  trackStatus.textContent = anyGenerating ? "generating next track..." : "";
}

function renderPlaylist() {
  playlistEl.innerHTML = tracks.map((t, i) => {
    const active = i === currentIndex ? "active" : "";
    const gen = t.status === "generating" ? "generating" : "";
    const statusText = t.status === "generating" ? "generating..." : t.status === "failed" ? "failed" : "";
    return `<div class="playlist-item ${active} ${gen}" data-idx="${i}">
      <span class="idx">${i + 1}</span>
      <span class="pl-prompt">${shortPrompt(t.prompt)}</span>
      <span class="pl-status">${statusText}</span>
    </div>`;
  }).join("");

  playlistEl.querySelectorAll(".playlist-item").forEach(el => {
    el.addEventListener("click", () => {
      const idx = parseInt(el.dataset.idx);
      if (tracks[idx]?.status === "ready") playTrack(idx);
    });
  });
}

// --- Playback ---

function playTrack(index) {
  if (index < 0 || index >= tracks.length) return;
  const track = tracks[index];
  if (track.status !== "ready") return;

  currentIndex = index;
  audio.src = `/api/audio/${track.audioFile}`;
  audio.play();
  isPlaying = true;
  updatePlayButton();
  updateNavButtons();
  trackNumber.textContent = index + 1;
  trackPrompt.textContent = shortPrompt(track.prompt);
  renderPlaylist();
  generationTriggered = false;
}

function maybeGenerateNext() {
  if (generationTriggered) return;
  if (currentIndex < 0) return;

  const latestReadyIndex = tracks.reduce((max, t, i) => t.status === "ready" ? i : max, -1);
  if (currentIndex !== latestReadyIndex) return;
  if (tracks.some(t => t.status === "generating")) return;

  const remaining = audio.duration - audio.currentTime;
  if (remaining <= TRIGGER_SECONDS_BEFORE_END && remaining > 0) {
    generationTriggered = true;
    requestGeneration();
  }
}

// --- Generation & polling ---

async function requestGeneration() {
  try {
    const resp = await fetch("/api/generate", { method: "POST" });
    const data = await resp.json();
    if (data.error) {
      console.error("Generation error:", data.error);
      return null;
    }
    tracks.push({
      taskId: data.taskId,
      prompt: data.promptUsed,
      status: "generating",
      audioFile: null,
    });
    renderPlaylist();
    updateVizGenerating();
    startPolling();
  } catch (err) {
    console.error("Request generation failed:", err);
  }
}

function startPolling() {
  if (pollInterval) return;
  pollInterval = setInterval(pollTasks, 3000);
}

function stopPollingIfDone() {
  if (!tracks.some(t => t.status === "generating")) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

async function pollTasks() {
  const pending = tracks.filter(t => t.status === "generating");
  if (pending.length === 0) { stopPollingIfDone(); return; }

  try {
    const resp = await fetch("/api/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskIds: pending.map(t => t.taskId) }),
    });
    const result = await resp.json();
    const taskResults = result.tasks || {};

    for (const track of pending) {
      const r = taskResults[track.taskId];
      if (!r) continue;
      if (r.status === 1) {
        track.status = "ready";
        track.audioFile = `${track.taskId}.mp3`;
        if (currentIndex === -1 && started) {
          playTrack(tracks.indexOf(track));
        }
      } else if (r.status === 2) {
        track.status = "failed";
      }
    }

    renderPlaylist();
    updateNavButtons();
    updateVizGenerating();
    stopPollingIfDone();
  } catch (err) {
    console.error("Poll error:", err);
  }
}

// --- Init ---

async function loadCachedTracks() {
  try {
    const resp = await fetch("/api/tracks");
    const cached = await resp.json();
    tracks = cached.filter(t => t.status === "ready");
    if (tracks.length > 0) {
      started = true;
      trackPrompt.textContent = `${tracks.length} track${tracks.length > 1 ? "s" : ""} in library`;
      renderPlaylist();
      updateNavButtons();
    }
  } catch (err) {
    console.error("Failed to load cached tracks:", err);
  }
}

loadCachedTracks();

// --- Audio events ---

audio.addEventListener("timeupdate", () => {
  progressFill.style.width = audio.duration ? `${(audio.currentTime / audio.duration) * 100}%` : "0%";
  timeCurrent.textContent = fmt(audio.currentTime);
  timeTotal.textContent = fmt(audio.duration);
  maybeGenerateNext();
});

audio.addEventListener("ended", () => {
  if (currentIndex + 1 < tracks.length && tracks[currentIndex + 1].status === "ready") {
    playTrack(currentIndex + 1);
  } else {
    isPlaying = false;
    updatePlayButton();
  }
});

audio.addEventListener("pause", () => {
  if (audio.ended) return;
  isPlaying = false;
  updatePlayButton();
});

audio.addEventListener("play", () => {
  isPlaying = true;
  updatePlayButton();
});

// --- Controls ---

btnPlay.addEventListener("click", () => {
  if (!started) {
    started = true;
    trackPrompt.textContent = "generating first track...";
    requestGeneration();
    return;
  }
  if (currentIndex === -1 && tracks.some(t => t.status === "ready")) {
    playTrack(tracks.findIndex(t => t.status === "ready"));
    return;
  }
  if (isPlaying) {
    audio.pause();
  } else if (audio.src) {
    audio.play();
  }
});

btnPrev.addEventListener("click", () => {
  if (currentIndex > 0) playTrack(currentIndex - 1);
});

btnNext.addEventListener("click", () => {
  if (currentIndex + 1 < tracks.length && tracks[currentIndex + 1].status === "ready") {
    playTrack(currentIndex + 1);
  }
});

progressBar.addEventListener("click", (e) => {
  if (!audio.duration) return;
  const rect = progressBar.getBoundingClientRect();
  audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
});

// Volume
const VOL_HIGH = "M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8.3v7.4a4.5 4.5 0 0 0 2.5-3.7zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1A9 9 0 0 0 14 3.2z";
const VOL_LOW = "M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8.3v7.4a4.5 4.5 0 0 0 2.5-3.7z";
const VOL_MUTE = "M16.5 12A4.5 4.5 0 0 0 14 8.3v1.5l2.4 2.4c.1-.4.1-.8.1-1.2zm2.5 0a7 7 0 0 1-.6 2.8l1.5 1.5A9 9 0 0 0 21 12a9 9 0 0 0-7-8.8v2.1a7 7 0 0 1 5 6.7zM4.3 3 3 4.3 7.7 9H3v6h4l5 5v-6.7l4.3 4.3c-.7.5-1.4.9-2.3 1.2v2.1a9 9 0 0 0 3.6-1.8l2.1 2.1 1.3-1.3-9-9L4.3 3zM12 4l-2.1 2.1L12 8.3V4z";
let preMuteVolume = 1;

function updateVolumeIcon(vol) {
  if (vol === 0) volPath.setAttribute("d", VOL_MUTE);
  else if (vol < 0.5) volPath.setAttribute("d", VOL_LOW);
  else volPath.setAttribute("d", VOL_HIGH);
}

volumeSlider.addEventListener("input", (e) => {
  const vol = parseFloat(e.target.value);
  audio.volume = vol;
  updateVolumeIcon(vol);
});

volumeIcon.addEventListener("click", () => {
  if (audio.volume > 0) {
    preMuteVolume = audio.volume;
    audio.volume = 0;
    volumeSlider.value = 0;
  } else {
    audio.volume = preMuteVolume;
    volumeSlider.value = preMuteVolume;
  }
  updateVolumeIcon(audio.volume);
});

document.addEventListener("keydown", (e) => {
  if (e.code === "Space") { e.preventDefault(); btnPlay.click(); }
  if (e.code === "ArrowLeft" && !btnPrev.disabled) btnPrev.click();
  if (e.code === "ArrowRight" && !btnNext.disabled) btnNext.click();
  if (e.code === "ArrowUp") {
    e.preventDefault();
    const vol = Math.min(1, audio.volume + 0.05);
    audio.volume = vol;
    volumeSlider.value = vol;
    updateVolumeIcon(vol);
  }
  if (e.code === "ArrowDown") {
    e.preventDefault();
    const vol = Math.max(0, audio.volume - 0.05);
    audio.volume = vol;
    volumeSlider.value = vol;
    updateVolumeIcon(vol);
  }
  if (e.code === "KeyM") {
    volumeIcon.click();
  }
});
