// Offline checks for the agenda tools. Run: node tools/test.mjs
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const dataSrc = join(here, "..", "data");
const tmp = mkdtempSync(join(tmpdir(), "agenda-test-"));
for (const name of ["inbox.json", "calendar.seed.json"]) {
  writeFileSync(join(tmp, name), readFileSync(join(dataSrc, name), "utf8"));
}

function run(...args) {
  try {
    const stdout = execFileSync("node", [join(here, "agenda.mjs"), ...args], {
      env: { ...process.env, AGENDA_DATA_DIR: tmp },
      encoding: "utf8",
    });
    return { code: 0, json: JSON.parse(stdout) };
  } catch (e) {
    return { code: e.status, json: JSON.parse(e.stdout) };
  }
}

let n = 0;
const ok = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};

ok("inbox lists 10 emails", () => {
  assert.equal(run("inbox").json.count, 10);
});

ok("inbox --id returns one email", () => {
  assert.equal(run("inbox", "--id", "6").json.email.subject, "RESCHEDULED: Project sync");
});

ok("seed calendar has 3 events", () => {
  assert.equal(run("calendar").json.count, 3);
});

ok("original sync slot conflicts with standup", () => {
  const r = run("check", "--start", "2026-11-03T10:00", "--end", "2026-11-03T10:45");
  assert.equal(r.json.free, false);
  assert.equal(r.json.conflicts[0].title, "Team standup");
});

ok("rescheduled sync slot is free", () => {
  const r = run("check", "--start", "2026-11-03T11:00", "--end", "2026-11-03T11:45");
  assert.equal(r.json.free, true);
});

ok("back-to-back events do not conflict", () => {
  const r = run("check", "--start", "2026-11-03T10:45", "--end", "2026-11-03T11:30");
  assert.equal(r.json.free, true);
});

ok("add refuses on conflict (exit code 2)", () => {
  const r = run("add", "--title", "Lunch with Lena", "--start", "2026-11-05T13:30", "--end", "2026-11-05T14:30");
  assert.equal(r.code, 2);
  assert.equal(r.json.ok, false);
  assert.equal(run("calendar").json.count, 3);
});

ok("add works on a free slot", () => {
  const r = run("add", "--title", "Project sync", "--start", "2026-11-03T11:00", "--end", "2026-11-03T11:45",
    "--place", "Room Borealis, Building 2", "--source", "6");
  assert.equal(r.json.ok, true);
  assert.equal(r.json.added.id, 4);
  assert.equal(run("calendar").json.count, 4);
});

ok("add --force over a conflict is explicit", () => {
  const r = run("add", "--title", "Lunch with Lena", "--start", "2026-11-05T13:30", "--end", "2026-11-05T14:30", "--force");
  assert.equal(r.json.ok, true);
  assert.equal(r.json.forced_over_conflicts.length, 1);
});

ok("bad dates are rejected", () => {
  assert.equal(run("add", "--title", "x", "--start", "tomorrow", "--end", "later").json.ok, false);
  assert.equal(run("check", "--start", "2026-11-03T12:00", "--end", "2026-11-03T11:00").json.ok, false);
  assert.equal(run("check", "--start", "2026-13-40T10:00", "--end", "2026-13-40T11:00").json.ok, false);
});

ok("remove and reset work", () => {
  assert.equal(run("remove", "--id", "4").json.ok, true);
  assert.equal(run("remove", "--id", "999").json.ok, false);
  run("reset");
  assert.equal(run("calendar").json.count, 3);
});

ok("real mailbox file is preferred, --demo forces the demo", () => {
  mkdirSync(join(tmp, "mail"));
  writeFileSync(join(tmp, "mail", "inbox.json"), JSON.stringify([
    { id: 501, from: "a@example.com", received: "2026-11-01T09:00", subject: "Real", body: "Meeting Nov 10 at 9:00" },
  ]));
  const real = run("inbox").json;
  assert.equal(real.count, 1);
  assert.equal(real.source, "real mailbox (read-only sync)");
  assert.equal(run("inbox", "--id", "501").json.email.subject, "Real");
  const demo = run("inbox", "--demo").json;
  assert.equal(demo.count, 10);
  assert.equal(demo.source, "demo inbox");
});

console.log(`\n${n} checks passed`);
