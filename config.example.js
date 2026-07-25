// ===== Party Jukebox configuration (TEMPLATE) =====
// Copy this file to `config.js` and fill in your own values.
// See README.md for step-by-step instructions on getting each one.
//
// NOTE: These values live in the browser and are NOT secrets:
//   • Firebase web config is public by design — you lock things down with
//     Realtime Database security rules (see README), not by hiding the config.
//   • The YouTube API key is client-side too — restrict it by HTTP referrer
//     in the Google Cloud console so only your site can use it.

export const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

export const YT_API_KEY = "YOUR_YOUTUBE_DATA_API_KEY";
