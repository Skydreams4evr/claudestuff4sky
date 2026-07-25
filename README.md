# 🎵 Party Jukebox

A collaborative party playlist. One device becomes the **speakers**, everyone
else opens a link on their phone and adds songs to a **shared queue**. The
queue syncs live across every phone, songs **auto-advance** when they finish,
and guests can **upvote** to bump a track up the line.

- 🔗 **No app to install** — it's a web page. Share a link, friends join.
- 📷 **Scan-to-join QR** — hold up your screen, guests scan and they're in.
- 🔍 **Search or paste** — find a song in-app, or paste any YouTube link.
- ⬆️ **Upvote to reorder** — the crowd decides what plays next.
- 🔊 **Plays itself** — the "speakers" device streams the queue in order.
- 🆓 **No servers to run** — static page + a free Firebase database.

No Google sign-in and no OAuth. The app's own queue *is* the playlist and it
plays songs directly via YouTube's embedded player.

---

## How it works

```
  Guests' phones                 Firebase Realtime DB              Speakers device
 ┌──────────────┐    add song   ┌────────────────────┐   live     ┌──────────────┐
 │  search /    │ ────────────► │  rooms/PARTY42/    │ ─────────► │ plays queue  │
 │  paste link  │               │    queue           │            │ top → bottom │
 │  upvote ▲    │ ◄──────────── │    nowPlaying      │ ◄───────── │ auto-advance │
 └──────────────┘   live sync   └────────────────────┘   updates  └──────────────┘
```

Everyone shares a **room code** (e.g. `PARTY42`). The queue is ordered by
upvotes, then by when it was added. Whichever device taps **🔊 Play here**
becomes the speakers and drives playback for the room.

---

## Setup (one time, ~10 minutes)

You need two free things: a **Firebase project** (holds the shared queue) and a
**YouTube Data API key** (powers search). Both are free for party-sized use.

### 1. Create a Firebase project + Realtime Database

1. Go to <https://console.firebase.google.com> and **Add project** (any name).
   You can skip Google Analytics.
2. In the left sidebar open **Build → Realtime Database** → **Create Database**.
   - Pick a location.
   - Start in **test mode** for now (we'll tighten the rules in step 3).
3. Register a web app: **Project settings** (gear icon) → **Your apps** →
   **Web** (`</>`). Give it a nickname, **Register app**. Firebase shows you a
   `firebaseConfig = { ... }` snippet — keep that tab open, you'll copy it in
   step 4.

### 2. Get a YouTube Data API key

1. Go to <https://console.cloud.google.com>. You can reuse the same Google
   project Firebase created, or make a new one.
2. **APIs & Services → Library** → search **YouTube Data API v3** → **Enable**.
3. **APIs & Services → Credentials → Create credentials → API key**. Copy it.
4. *(Recommended)* Click the key → **Application restrictions → Websites** and
   add your site's URL (e.g. `https://yourname.github.io/*`) so only your page
   can use the key. Under **API restrictions**, limit it to *YouTube Data API v3*.

> The free YouTube quota is 10,000 units/day. A search costs ~100 units, so
> that's ~100 searches a day. Pasting links is nearly free — encourage guests
> to paste when you're running low.

### 3. Lock down the database rules

In **Realtime Database → Rules**, paste this and **Publish**. It keeps writes
scoped to room data and stops anyone dumping junk at the root:

```json
{
  "rules": {
    "rooms": {
      "$room": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

This is open-but-scoped — fine for a party where you trust whoever has the
link. For anything more locked down, add Firebase Auth and gate `.write` on
`auth != null`.

### 4. Fill in `config.js`

Open **`config.js`** and paste in your values:

- The `firebaseConfig` object from step 1.3 (copy it wholesale).
- Your YouTube API key from step 2 into `YT_API_KEY`.

Make sure `databaseURL` is present — if the Firebase snippet didn't include it,
it's `https://YOUR_PROJECT-default-rtdb.firebaseio.com` (find it on the
Realtime Database page).

### 5. Put it online

It's a static site, so any static host works. Easiest is **GitHub Pages**:

1. Push this repo to GitHub.
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   pick your branch and `/ (root)`, save.
3. Your jukebox is live at `https://<you>.github.io/<repo>/`.

Prefer something else? `netlify deploy`, Vercel, Cloudflare Pages, or even
`python3 -m http.server` on a laptop all work — it's just static files.

---

## Running a party

1. On the device hooked up to the speakers, open the site, enter your name,
   and tap **Create a new room** (or type a code). Then tap **🔊 Play here** so
   that device becomes the player.
2. Tap **🔗 Share** to pop up a big **QR code** — guests point their camera at
   your screen to jump straight into the room (or copy/AirDrop/text the link).
   A live QR also appears on the join screen as soon as a room code is set.
3. Everyone opens the link, enters a name, and starts adding songs — search by
   name or paste a YouTube URL.
4. Sit back. Songs play top-to-bottom and auto-advance. Upvote (▲) to move a
   track up; anyone can **⏭ skip** or **⏯ pause**.

**Tip:** only *one* device should be the speakers, or you'll get double audio.
The others are just remotes for adding and voting.

---

## Files

| File | What it is |
|------|------------|
| `index.html` | Page markup — join screen, now-playing, queue, add bar |
| `styles.css` | Neon party theme, mobile-first |
| `app.js` | All the logic: Firebase sync, YouTube search/playback, voting, auto-advance, QR |
| `qrcode.js` | Vendored QR generator ([qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator), MIT) — powers scan-to-join |
| `config.js` | Your Firebase + YouTube keys (**edit this**) |
| `config.example.js` | Template for `config.js` |

## Troubleshooting

- **"Almost there" setup screen won't go away** — `config.js` still has
  `YOUR_...` placeholders, or `databaseURL` is missing. Fill them and reload.
- **Search says "API: quotaExceeded"** — you've hit the daily YouTube quota.
  Wait for the daily reset or paste links instead of searching.
- **Search says "keyInvalid" / "forbidden"** — the key is wrong, the YouTube
  Data API isn't enabled, or the referrer restriction is blocking your URL.
- **Songs don't sync between phones** — check the database rules were
  published and `databaseURL` in `config.js` matches your project.
- **A song won't play / instantly skips** — some videos block embedding; the
  app skips those automatically.
