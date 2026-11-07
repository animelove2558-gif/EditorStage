// Rotating error log (userData/logs/editorstage.log). Kept free of Electron so scripts/test_crashlog.mjs can run it in Node:
// the folder is given with setDir(). Entries hold the time, a kind, and a message (paths and stack traces only).
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 512 * 1024; const KEEP = 3; const MAX_MSG = 4000;
let dir = null;
const setDir = (d) => { dir = d; };
const logFile = () => (dir ? path.join(dir, 'editorstage.log') : null);

function rotate(file) {
  try {
    if (fs.statSync(file).size < MAX_BYTES) return;
    for (let i = KEEP - 1; i >= 1; i--) { try { fs.renameSync(i === 1 ? file : file.replace(/\.log$/, `.${i - 1}.log`), file.replace(/\.log$/, `.${i}.log`)); } catch { /* missing */ } }
  } catch { /* no file yet */ }
}

/** Append one entry. Never throws: logging must not be able to cause a crash. */
function log(kind, msg) {
  try {
    const file = logFile(); if (!file) return false;
    fs.mkdirSync(dir, { recursive: true }); rotate(file);
    const text = String((msg && msg.stack) || (msg && msg.message) || msg).slice(0, MAX_MSG).replace(/\r?\n/g, '\n    ');
    fs.appendFileSync(file, `${new Date().toISOString()} [${kind}] ${text}\n`);
    return true;
  } catch { return false; }
}

/** Counts events inside a time window ("stop reloading after 2 crashes in a minute"). */
function createBurst(limit, windowMs, now = Date.now) {
  let times = [];
  return { hit() { const t = now(); times = times.filter((x) => t - x < windowMs); times.push(t); return times.length > limit; } };
}

module.exports = { setDir, log, logFile, createBurst, MAX_BYTES };
