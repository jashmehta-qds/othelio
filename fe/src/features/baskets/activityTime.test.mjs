import assert from "node:assert/strict";
import test from "node:test";
import { formatActivityTime } from "./activityTime.ts";

const now = new Date("2026-10-03T18:00:00-04:00");

test("formats recent activity with relative time", () => {
  assert.equal(formatActivityTime("2026-10-03T16:00:00-04:00", now), "2 hours ago");
  assert.equal(formatActivityTime("2026-10-03T17:56:00-04:00", now), "4 minutes ago");
});

test("uses the local calendar boundary for yesterday", () => {
  assert.equal(formatActivityTime("2026-10-02T23:30:00-04:00", now), "yesterday");
});

test("uses dates for older activity and handles invalid timestamps", () => {
  assert.equal(formatActivityTime("2026-09-20T12:00:00-04:00", now), "Sep 20");
  assert.equal(formatActivityTime("not-a-date", now), "Time unavailable");
});
