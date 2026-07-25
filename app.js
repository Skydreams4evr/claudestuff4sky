// ===== Party Jukebox — app logic =====
// Loads config, wires up Firebase Realtime Database for the shared queue,
// YouTube Data API for search, and the YouTube IFrame API for playback.

import {
  firebaseConfig,
  YT_API_KEY,
} from "./config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getDatabase, ref, onValue, push, set, update, remove,
  runTransaction, onDisconnect, serverTimestamp, get,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ---------- tiny DOM helpers ----------
const $ = (sel) => document.querySelector(sel);
const show = (el) => el.classList.remove("hidden");
const hide = (el) => el.classList.add("hidden");

let toastTimer = null;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  show(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hide(t), 2600);
}

// ---------- config sanity check ----------
function configLooksReal() {
  try {
    return (
      firebaseConfig &&
      firebaseConfig.apiKey &&
      !String(firebaseConfig.apiKey).includes("YOUR_") &&
      firebaseConfig.databaseURL &&
      YT_API_KEY &&
      !String(YT_API_KEY).includes("YOUR_")
    );
  } catch {
    return false;
  }
}

if (!configLooksReal()) {
  const gate = $("#setup-gate");
  $("#gate-detail").textContent =
    "Missing: " +
    [
      !firebaseConfig?.apiKey && "firebaseConfig.apiKey",
      !firebaseConfig?.databaseURL && "firebaseConfig.databaseURL",
      (!YT_API_KEY || String(YT_API_KEY).includes("YOUR_")) && "YT_API_KEY",
    ]
      .filter(Boolean)
      .join(", ");
  show(gate);
  throw new Error("Jukebox config missing — see setup gate.");
}

// ---------- Firebase init ----------
const fbApp = initializeApp(firebaseConfig);
const db = getDatabase(fbApp);

// ---------- device identity ----------
const uid = (() => {
  let v = localStorage.getItem("jukebox_uid");
  if (!v) {
    v = "u_" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem("jukebox_uid", v);
  }
  return v;
})();
let myName = localStorage.getItem("jukebox_name") || "";

// ---------- state ----------
let roomCode = null;
let isSpeakers = false;       // this device plays audio + drives auto-advance
let player = null;            // YT.Player instance (only on the speakers device)
let ytReady = false;
let queueCache = [];          // [{key, ...}]
let nowPlaying = null;
let unsubscribers = [];

// ---------- YouTube IFrame API ----------
// The module may finish loading either before or after the IFrame API script,
// so cover both orderings.
window.onYouTubeIframeAPIReady = () => { ytReady = true; };
if (window.YT && window.YT.Player) ytReady = true;

// ===================================================================
// Join / room flow
// ===================================================================
function randomRoom() {
  const words = ["PARTY", "VIBE", "GROOVE", "MIX", "JAM", "BASS", "NEON", "DISCO"];
  return words[Math.floor(Math.random() * words.length)] + Math.floor(10 + Math.random() * 89);
}

function initJoinScreen() {
  const nameInput = $("#name-input");
  const roomInput = $("#room-input");
  nameInput.value = myName;

  // Pre-fill room from ?room=CODE
  const urlRoom = new URLSearchParams(location.search).get("room");
  if (urlRoom) roomInput.value = urlRoom.toUpperCase();

  const doJoin = () => {
    const name = nameInput.value.trim();
    const code = roomInput.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!name) return toast("Enter your name first");
    if (!code) return toast("Enter a room code");
    myName = name;
    localStorage.setItem("jukebox_name", name);
    enterRoom(code);
  };

  $("#join-btn").addEventListener("click", doJoin);
  $("#create-btn").addEventListener("click", () => {
    roomInput.value = randomRoom();
    doJoin();
  });
  roomInput.addEventListener("keydown", (e) => { if (e.key === "Enter") doJoin(); });
  nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") roomInput.focus(); });

  show($("#join"));
}

function enterRoom(code) {
  roomCode = code;
  history.replaceState(null, "", "?room=" + encodeURIComponent(code));
  $("#room-label").textContent = code;
  hide($("#join"));
  show($("#app"));
  subscribeRoom();
  toast("Joined room " + code);
}

function leaveRoom() {
  unsubscribers.forEach((fn) => fn());
  unsubscribers = [];
  if (player) { try { player.stopVideo(); } catch {} }
  isSpeakers = false;
  $("#speakers-btn").classList.remove("speakers-on");
  $("#player-host").classList.remove("active");
  hide($("#app"));
  show($("#join"));
  history.replaceState(null, "", location.pathname);
}

// ===================================================================
// Realtime subscriptions
// ===================================================================
function roomRef(path) { return ref(db, "rooms/" + roomCode + (path ? "/" + path : "")); }

function subscribeRoom() {
  // Queue
  const uQ = onValue(roomRef("queue"), (snap) => {
    const val = snap.val() || {};
    queueCache = Object.entries(val).map(([key, v]) => ({ key, ...v }));
    sortQueue();
    renderQueue();
    maybeAutoStart();
  });

  // Now playing
  const uN = onValue(roomRef("nowPlaying"), (snap) => {
    nowPlaying = snap.val();
    renderNowPlaying();
    syncPlayer();
  });

  // Control channel (skip / pause) — only the speakers device acts on it
  const uC = onValue(roomRef("control"), (snap) => {
    const cmd = snap.val();
    if (!cmd || !isSpeakers) return;
    if (cmd.action === "skip") advance();
    if (cmd.action === "toggle") togglePlayLocal();
    remove(roomRef("control")); // consume
  });

  unsubscribers.push(uQ, uN, uC);
}

function sortQueue() {
  queueCache.sort((a, b) => {
    const vd = (b.voteCount || 0) - (a.voteCount || 0);
    if (vd !== 0) return vd;
    return (a.addedAt || 0) - (b.addedAt || 0);
  });
}

// ===================================================================
// Rendering
// ===================================================================
function renderQueue() {
  const ul = $("#queue");
  const empty = $("#queue-empty");
  $("#queue-count").textContent = queueCache.length;
  ul.innerHTML = "";

  if (queueCache.length === 0) { show(empty); return; }
  hide(empty);

  for (const item of queueCache) {
    const li = document.createElement("li");
    li.className = "q-item";
    const voted = item.votes && item.votes[uid];
    li.innerHTML = `
      <img class="q-thumb" src="${item.thumb || ""}" alt="" />
      <div class="q-info">
        <div class="q-title"></div>
        <div class="q-by"></div>
      </div>
      <div class="q-actions">
        <button class="vote ${voted ? "voted" : ""}">▲ <span>${item.voteCount || 0}</span></button>
        <button class="q-remove" title="Remove">✕</button>
      </div>`;
    li.querySelector(".q-title").textContent = item.title || "Untitled";
    li.querySelector(".q-by").textContent = "added by " + (item.addedByName || "someone");
    li.querySelector(".vote").addEventListener("click", () => toggleVote(item));
    li.querySelector(".q-remove").addEventListener("click", () => removeItem(item));
    ul.appendChild(li);
  }
}

function renderNowPlaying() {
  const empty = $("#np-empty");
  const meta = $("#np-meta");
  const banner = $("#np-banner");

  if (!nowPlaying) {
    show(empty);
    meta.classList.remove("active");
    banner.classList.remove("show");
    $("#player-host").classList.remove("active");
    return;
  }
  hide(empty);
  meta.classList.add("active");
  // Only the speakers device shows the actual video iframe.
  $("#player-host").classList.toggle("active", isSpeakers && !!nowPlaying);
  $("#np-thumb").src = nowPlaying.thumb || "";
  $("#np-title").textContent = nowPlaying.title || "Untitled";
  $("#np-by").textContent = "added by " + (nowPlaying.addedByName || "someone");

  // Controls only meaningful on the speakers device
  $("#np-controls").style.display = isSpeakers ? "flex" : "flex";

  if (!isSpeakers) {
    banner.textContent = "🔊 Playing on the party speakers";
    banner.classList.add("show");
  } else {
    banner.classList.remove("show");
  }
}

// ===================================================================
// Voting / removal
// ===================================================================
function toggleVote(item) {
  const itemRef = roomRef("queue/" + item.key);
  runTransaction(itemRef, (cur) => {
    if (!cur) return cur;
    cur.votes = cur.votes || {};
    if (cur.votes[uid]) { delete cur.votes[uid]; }
    else { cur.votes[uid] = true; }
    cur.voteCount = Object.keys(cur.votes).length;
    return cur;
  });
}

function removeItem(item) {
  remove(roomRef("queue/" + item.key));
  toast("Removed “" + (item.title || "song") + "”");
}

// ===================================================================
// Adding songs (search + paste)
// ===================================================================
function parseVideoId(text) {
  const t = text.trim();
  // Various YouTube URL shapes
  const patterns = [
    /(?:youtube\.com\/watch\?[^ ]*[?&]v=)([A-Za-z0-9_-]{11})/,
    /(?:youtu\.be\/)([A-Za-z0-9_-]{11})/,
    /(?:youtube\.com\/(?:embed|shorts|live)\/)([A-Za-z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (m) return m[1];
  }
  if (/^[A-Za-z0-9_-]{11}$/.test(t)) return t; // bare id
  return null;
}

async function ytFetch(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const reason = body?.error?.errors?.[0]?.reason || res.status;
    throw new Error("YouTube API: " + reason);
  }
  return res.json();
}

async function lookupVideo(videoId) {
  const url =
    "https://www.googleapis.com/youtube/v3/videos?part=snippet&id=" +
    encodeURIComponent(videoId) + "&key=" + YT_API_KEY;
  const data = await ytFetch(url);
  const v = data.items?.[0];
  if (!v) return null;
  return {
    videoId,
    title: v.snippet.title,
    thumb: v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url || "",
    channel: v.snippet.channelTitle,
  };
}

async function searchVideos(query) {
  const url =
    "https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=12&q=" +
    encodeURIComponent(query) + "&key=" + YT_API_KEY;
  const data = await ytFetch(url);
  return (data.items || []).map((v) => ({
    videoId: v.id.videoId,
    title: v.snippet.title,
    thumb: v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url || "",
    channel: v.snippet.channelTitle,
  }));
}

function addToQueue(song) {
  const item = {
    videoId: song.videoId,
    title: decodeEntities(song.title),
    thumb: song.thumb,
    addedBy: uid,
    addedByName: myName,
    votes: {},
    voteCount: 0,
    addedAt: Date.now(),
  };
  push(roomRef("queue"), item);
  toast("Added “" + item.title + "”");
}

function decodeEntities(s) {
  const el = document.createElement("textarea");
  el.innerHTML = s || "";
  return el.value;
}

function renderResults(list) {
  const box = $("#results");
  box.innerHTML = "";
  if (!list || list.length === 0) {
    box.innerHTML = `<div class="results-msg">No results — try different words or paste a link.</div>`;
    show(box);
    return;
  }
  for (const song of list) {
    const row = document.createElement("div");
    row.className = "result";
    row.innerHTML = `
      <img src="${song.thumb}" alt="" />
      <div style="min-width:0;flex:1">
        <div class="r-title"></div>
        <div class="r-sub"></div>
      </div>
      <div class="r-add">＋</div>`;
    row.querySelector(".r-title").textContent = decodeEntities(song.title);
    row.querySelector(".r-sub").textContent = song.channel || "";
    row.addEventListener("click", () => {
      addToQueue(song);
      hide(box);
      $("#search-input").value = "";
    });
    box.appendChild(row);
  }
  show(box);
}

async function handleAdd() {
  const input = $("#search-input");
  const text = input.value.trim();
  if (!text) return;

  const vid = parseVideoId(text);
  const btn = $("#search-btn");
  btn.disabled = true;
  btn.textContent = "…";
  try {
    if (vid) {
      const song = await lookupVideo(vid);
      if (!song) return toast("Couldn't find that video");
      addToQueue(song);
      input.value = "";
      hide($("#results"));
    } else {
      const results = await searchVideos(text);
      renderResults(results);
    }
  } catch (err) {
    toast(err.message || "Search failed");
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = "Add";
  }
}

// ===================================================================
// Speakers device — playback + auto-advance
// ===================================================================
function becomeSpeakers() {
  if (!ytReady) return toast("Player still loading — try again in a sec");
  isSpeakers = !isSpeakers;
  const btn = $("#speakers-btn");

  if (isSpeakers) {
    btn.classList.add("speakers-on");
    btn.textContent = "🔊 Playing here";
    $("#player-host").classList.add("active");
    ensurePlayer();
    syncPlayer();
    maybeAutoStart();
    toast("This device is now the party speakers 🔊");
  } else {
    btn.classList.remove("speakers-on");
    btn.textContent = "🔊 Play here";
    $("#player-host").classList.remove("active");
    if (player) { try { player.stopVideo(); } catch {} }
    toast("Stopped playing on this device");
  }
  renderNowPlaying();
}

function ensurePlayer() {
  if (player) return;
  player = new YT.Player("yt-mount", {
    height: "100%",
    width: "100%",
    playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1 },
    events: {
      onReady: () => syncPlayer(),
      onStateChange: (e) => { if (e.data === YT.PlayerState.ENDED) advance(); },
      onError: () => { toast("Song couldn't play — skipping"); advance(); },
    },
  });
}

// Keep the speakers device's iframe matched to nowPlaying
let lastLoadedVideo = null;
function syncPlayer() {
  if (!isSpeakers || !player || !player.loadVideoById) return;
  if (!nowPlaying) {
    if (lastLoadedVideo !== null) { try { player.stopVideo(); } catch {} lastLoadedVideo = null; }
    return;
  }
  if (nowPlaying.videoId !== lastLoadedVideo) {
    lastLoadedVideo = nowPlaying.videoId;
    try { player.loadVideoById(nowPlaying.videoId); } catch (e) { console.error(e); }
  }
}

function togglePlayLocal() {
  if (!player) return;
  const s = player.getPlayerState?.();
  if (s === YT.PlayerState.PLAYING) player.pauseVideo();
  else player.playVideo();
}

// If nothing is playing but there's a queue, the speakers device starts it.
function maybeAutoStart() {
  if (!isSpeakers) return;
  if (nowPlaying) return;
  if (queueCache.length === 0) return;
  advance();
}

// Pop the top of the queue into nowPlaying. Only the speakers device calls this,
// guarded by a transaction so a momentary double-fire can't double-advance.
function advance() {
  if (!isSpeakers) return;
  sortQueue();
  const next = queueCache[0];

  runTransaction(roomRef("nowPlaying"), (cur) => {
    // Someone else may have advanced already; keep whatever's newest.
    if (cur && next && cur.videoId === next.videoId && cur.key === next.key) return cur;
    if (!next) return null; // queue empty -> clear
    return {
      key: next.key,
      videoId: next.videoId,
      title: next.title,
      thumb: next.thumb,
      addedByName: next.addedByName,
      startedAt: Date.now(),
    };
  }).then((result) => {
    // Remove the picked item from the queue (if we set it).
    const np = result?.snapshot?.val?.();
    if (np && np.key) remove(roomRef("queue/" + np.key));
  }).catch((e) => console.error(e));
}

// ===================================================================
// Share
// ===================================================================
async function share() {
  const url = location.origin + location.pathname + "?room=" + encodeURIComponent(roomCode);
  const shareData = { title: "Party Jukebox", text: "Add songs to our party queue!", url };
  if (navigator.share) {
    try { await navigator.share(shareData); return; } catch {}
  }
  try {
    await navigator.clipboard.writeText(url);
    toast("Room link copied to clipboard 📋");
  } catch {
    prompt("Copy this room link:", url);
  }
}

// ===================================================================
// Wire up app controls
// ===================================================================
function initAppControls() {
  $("#search-btn").addEventListener("click", handleAdd);
  $("#search-input").addEventListener("keydown", (e) => { if (e.key === "Enter") handleAdd(); });
  $("#speakers-btn").addEventListener("click", becomeSpeakers);
  $("#share-btn").addEventListener("click", share);
  $("#leave-btn").addEventListener("click", leaveRoom);

  // Skip / pause: on the speakers device act directly; elsewhere send a command.
  $("#skip-btn").addEventListener("click", () => {
    if (isSpeakers) advance();
    else set(roomRef("control"), { action: "skip", ts: Date.now() });
    toast("Skipping…");
  });
  $("#pause-btn").addEventListener("click", () => {
    if (isSpeakers) togglePlayLocal();
    else set(roomRef("control"), { action: "toggle", ts: Date.now() });
  });
}

// ===================================================================
// Boot
// ===================================================================
initJoinScreen();
initAppControls();
