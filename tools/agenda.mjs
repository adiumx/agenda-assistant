#!/usr/bin/env node
// Agenda tools for the assistant. No dependencies, Node 18+.
// All output is JSON so the agent can read it reliably.
//
//   node tools/agenda.mjs inbox [--id N] [--demo]
//   node tools/agenda.mjs calendar
//   node tools/agenda.mjs check --start 2026-11-03T10:00 --end 2026-11-03T10:45
//   node tools/agenda.mjs add --title "..." --start ... --end ... [--place "..."] [--source N] [--force]
//   node tools/agenda.mjs remove --id N
//   node tools/agenda.mjs reset
//
// Data files live in ../data (override with AGENDA_DATA_DIR).
// Inbox: if data/mail/inbox.json exists (written by sync/ from a real mailbox)
// it is used; otherwise the demo inbox data/inbox.json. --demo forces the demo.
import { readFileSync, existsSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.AGENDA_DATA_DIR ?? join(here, "..", "data");
const demoInboxPath = join(dataDir, "inbox.json");
const realInboxPath = join(dataDir, "mail", "inbox.json");
const seedPath = join(dataDir, "calendar.seed.json");
const calendarPath = join(dataDir, "calendar.json");

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const out = (obj) => console.log(JSON.stringify(obj, null, 2));
const fail = (message) => {
  out({ ok: false, error: message });
  process.exit(1);
};

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

// Inside the OpenShell sandbox, a file that was just written could be read back
// empty or zero-filled (copyFileSync and a write followed by a read both did).
// So: write with fsync, and never re-read a file we just wrote; use the text
// we already have in memory.
function writeDurable(path, text) {
  const fd = openSync(path, "w");
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

const writeJson = (path, value) => writeDurable(path, JSON.stringify(value, null, 2) + "\n");

function loadCalendar() {
  if (!existsSync(calendarPath)) {
    const seed = JSON.parse(readFileSync(seedPath, "utf8"));
    writeJson(calendarPath, seed);
    return seed; // from memory, not re-read
  }
  return JSON.parse(readFileSync(calendarPath, "utf8"));
}
const saveCalendar = (events) => writeJson(calendarPath, events);

function validRange(start, end) {
  if (typeof start !== "string" || !ISO.test(start)) return "start must look like 2026-11-03T10:00";
  if (typeof end !== "string" || !ISO.test(end)) return "end must look like 2026-11-03T10:45";
  if (Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) return "start/end are not real dates";
  if (end <= start) return "end must be after start";
  return null;
}

// ISO strings of the same shape compare correctly as plain strings.
const overlaps = (a, b) => a.start < b.end && b.start < a.end;
const conflictsFor = (events, start, end) => events.filter((e) => overlaps(e, { start, end }));

const [command, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

switch (command) {
  case "inbox": {
    const useReal = !args.demo && existsSync(realInboxPath);
    const source = useReal ? "real mailbox (read-only sync)" : "demo inbox";
    const emails = JSON.parse(readFileSync(useReal ? realInboxPath : demoInboxPath, "utf8"));
    if (args.id !== undefined) {
      const email = emails.find((e) => String(e.id) === String(args.id));
      if (!email) fail(`no email with id ${args.id}`);
      out({ ok: true, source, email });
    } else {
      out({ ok: true, source, count: emails.length, emails });
    }
    break;
  }

  case "calendar": {
    const events = loadCalendar().sort((a, b) => a.start.localeCompare(b.start));
    out({ ok: true, count: events.length, events });
    break;
  }

  case "check": {
    const err = validRange(args.start, args.end);
    if (err) fail(err);
    const conflicts = conflictsFor(loadCalendar(), args.start, args.end);
    out({ ok: true, free: conflicts.length === 0, conflicts });
    break;
  }

  case "add": {
    if (!args.title || args.title === true) fail("--title is required");
    const err = validRange(args.start, args.end);
    if (err) fail(err);
    const events = loadCalendar();
    const conflicts = conflictsFor(events, args.start, args.end);
    if (conflicts.length && !args.force) {
      out({
        ok: false,
        error: "conflict: nothing was added. Ask the user what to do, or re-run with --force if they confirm.",
        conflicts,
      });
      process.exit(2);
    }
    const id = events.reduce((m, e) => Math.max(m, e.id), 0) + 1;
    const event = { id, title: args.title, start: args.start, end: args.end };
    if (typeof args.place === "string") event.place = args.place;
    if (args.source !== undefined) event.source_email = Number(args.source);
    events.push(event);
    saveCalendar(events);
    out({ ok: true, added: event, forced_over_conflicts: conflicts.length > 0 ? conflicts : undefined });
    break;
  }

  case "remove": {
    if (args.id === undefined) fail("--id is required");
    const events = loadCalendar();
    const keep = events.filter((e) => String(e.id) !== String(args.id));
    if (keep.length === events.length) fail(`no event with id ${args.id}`);
    saveCalendar(keep);
    out({ ok: true, removed_id: Number(args.id) });
    break;
  }

  case "reset": {
    writeJson(calendarPath, JSON.parse(readFileSync(seedPath, "utf8")));
    out({ ok: true, message: "calendar restored to the demo state" });
    break;
  }

  default:
    fail("unknown command. Use: inbox | calendar | check | add | remove | reset");
}
