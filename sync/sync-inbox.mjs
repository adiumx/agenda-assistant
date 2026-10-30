#!/usr/bin/env node
// Read-only IMAP sync: downloads the most recent emails and writes them in the
// agenda tool's inbox format. Runs OUTSIDE the sandbox, so the mailbox password
// never enters it.
//
//   node sync/sync-inbox.mjs [--out path/to/inbox.json]
//
// Read-only guarantees (verified in imapflow 2.10.0 source):
//   - the mailbox is opened with EXAMINE (readOnly: true), and we abort unless
//     the server confirms READ-ONLY;
//   - message bodies are fetched with BODY.PEEK[], so nothing is marked as read;
//   - this script sends no STORE / COPY / MOVE / EXPUNGE / APPEND commands.
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { mkdirSync, openSync, writeSync, fsyncSync, closeSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile, toInboxEntry } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const env = { ...loadEnvFile(join(here, ".env")), ...process.env };

const outArg = process.argv.indexOf("--out");
const outPath = outArg > -1 ? process.argv[outArg + 1] : join(here, "staging", "mail", "inbox.json");

const cfg = {
  host: env.IMAP_HOST || "imap.gmail.com",
  port: Number(env.IMAP_PORT || 993),
  user: env.IMAP_USER,
  pass: env.IMAP_PASS,
  mailbox: env.IMAP_MAILBOX || "INBOX",
  days: Number(env.SYNC_DAYS || 7),
  max: Number(env.SYNC_MAX || 20),
  bodyChars: Number(env.SYNC_BODY_CHARS || 1500),
  maxBytes: Number(env.SYNC_MAX_BYTES || 300000), // per message download cap
  timeZone: env.SYNC_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
};

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);
const die = (msg) => {
  console.error(`[${new Date().toISOString()}] ERROR: ${msg}`);
  process.exit(1);
};

if (!cfg.user || !cfg.pass) die("IMAP_USER and IMAP_PASS must be set in sync/.env (use an app password).");
if (!(cfg.max > 0 && cfg.max <= 200)) die("SYNC_MAX must be between 1 and 200.");

function writeAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  const fd = openSync(tmp, "w");
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}

const client = new ImapFlow({
  host: cfg.host,
  port: cfg.port,
  secure: true,
  auth: { user: cfg.user, pass: cfg.pass },
  logger: false, // never log protocol traffic (it would include credentials)
});

try {
  await client.connect();
  const lock = await client.getMailboxLock(cfg.mailbox, { readOnly: true });
  const emails = [];
  try {
    if (client.mailbox?.readOnly !== true) die("server did not confirm READ-ONLY; aborting without reading anything.");

    const since = new Date(Date.now() - cfg.days * 24 * 60 * 60 * 1000);
    const uids = (await client.search({ since }, { uid: true })) || [];
    const recent = uids.sort((a, b) => a - b).slice(-cfg.max);

    if (recent.length) {
      for await (const msg of client.fetch(
        recent,
        { uid: true, internalDate: true, source: { maxLength: cfg.maxBytes } },
        { uid: true },
      )) {
        const parsed = await simpleParser(msg.source);
        emails.push(toInboxEntry({
          uid: msg.uid, parsed, internalDate: msg.internalDate, timeZone: cfg.timeZone, maxChars: cfg.bodyChars,
        }));
      }
    }
  } finally {
    lock.release();
  }
  await client.logout();

  emails.sort((a, b) => a.received.localeCompare(b.received) || a.id - b.id);
  writeAtomic(outPath, JSON.stringify(emails, null, 2) + "\n");
  // Only counts are logged, never subjects or bodies.
  log(`synced ${emails.length} email(s) from the last ${cfg.days} day(s) of "${cfg.mailbox}" -> ${outPath}`);
} catch (err) {
  try { await client.logout(); } catch {}
  die(err?.responseText || err?.message || String(err));
}
