// Offline tests for sync/lib.mjs (needs `npm install` in sync/ for mailparser).
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simpleParser } from "mailparser";
import { loadEnvFile, toLocalIso, cleanBody, toInboxEntry } from "./lib.mjs";

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log(`ok - ${name}`); };

await ok("loadEnvFile reads keys, quotes and comments", () => {
  const dir = mkdtempSync(join(tmpdir(), "env-"));
  writeFileSync(join(dir, ".env"), "# c\nIMAP_USER=me@x.com\nIMAP_PASS=\"abcd efgh ijkl mnop\"\nEMPTY=\nBAD LINE\n");
  const env = loadEnvFile(join(dir, ".env"));
  assert.equal(env.IMAP_USER, "me@x.com");
  assert.equal(env.IMAP_PASS, "abcd efgh ijkl mnop");
  assert.equal(env.EMPTY, "");
  assert.equal(loadEnvFile(join(dir, "missing")).IMAP_USER, undefined);
});

await ok("toLocalIso converts to the requested time zone", () => {
  const d = new Date("2026-11-03T17:05:00Z");
  assert.equal(toLocalIso(d, "America/Mexico_City"), "2026-11-03T11:05");
  assert.equal(toLocalIso(d, "UTC"), "2026-11-03T17:05");
});

await ok("cleanBody drops quoted history and truncates", () => {
  const text = "Can we meet Tue at 10?\n\nOn Mon, Nov 2, 2026 Ana wrote:\n> old stuff\n> more";
  assert.equal(cleanBody({ text }), "Can we meet Tue at 10?");
  const es = "Nos vemos el martes.\nEl lun, 2 nov 2026, Ana escribió:\n> viejo";
  assert.equal(cleanBody({ text: es }), "Nos vemos el martes.");
  assert.ok(cleanBody({ text: "x".repeat(50) }, 10).endsWith("[...]"));
});

await ok("cleanBody falls back to HTML", () => {
  const html = "<html><style>p{}</style><p>Dinner&nbsp;at <b>8</b></p><p>Cafe &amp; Bar</p></html>";
  assert.equal(cleanBody({ text: "", html }), "Dinner at 8 Cafe & Bar");
});

await ok("a real MIME message becomes an inbox entry", async () => {
  const raw = [
    "From: Priya Nair <priya@example.com>",
    "To: me@example.com",
    "Subject: Project sync",
    "Date: Tue, 03 Nov 2026 17:05:00 +0000",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Project sync on Nov 10 at 11:00 in Room Borealis.",
    "",
    "On Mon, Nov 2, 2026 Me wrote:",
    "> earlier message",
  ].join("\r\n");
  const parsed = await simpleParser(Buffer.from(raw));
  const entry = toInboxEntry({ uid: 4242, parsed, internalDate: new Date(), timeZone: "America/Mexico_City", maxChars: 1500 });
  assert.deepEqual(entry, {
    id: 4242,
    from: '"Priya Nair" <priya@example.com>',
    received: "2026-11-03T11:05",
    subject: "Project sync",
    body: "Project sync on Nov 10 at 11:00 in Room Borealis.",
  });
});

await ok("HTML-only MIME message and missing date", async () => {
  const raw = [
    "From: news@example.com",
    "Subject: =?UTF-8?Q?Reuni=C3=B3n?=",
    "Content-Type: text/html; charset=utf-8",
    "",
    "<p>Reuni&oacute;n el <b>jueves</b> a las 9</p>",
  ].join("\r\n");
  const parsed = await simpleParser(Buffer.from(raw));
  const entry = toInboxEntry({ uid: 7, parsed, internalDate: new Date("2026-11-05T15:00:00Z"), timeZone: "UTC", maxChars: 1500 });
  assert.equal(entry.subject, "Reunión");
  assert.equal(entry.received, "2026-11-05T15:00");
  assert.match(entry.body, /jueves a las 9/);
});

console.log(`\n${n} checks passed`);
