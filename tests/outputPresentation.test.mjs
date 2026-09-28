import assert from "node:assert/strict";
import test from "node:test";
import { appendOutput, cleanOutput, isAtOutputBottom } from "../src/lib/outputPresentation.ts";

test("rendered Rust blocks get one trailing newline, not an extra blank line", () => {
  let output = appendOutput("", "Compiling app\n");
  output = appendOutput(output, "warning: unused variable\n --> src/main.rs:2:3\n\n");
  output = appendOutput(output, "Finished dev profile");
  assert.equal(output, "Compiling app\nwarning: unused variable\n --> src/main.rs:2:3\nFinished dev profile\n");
});

test("terminal cursor sequences, colours and hyperlink controls are removed", () => {
  const text = "\x1b[1;31merror\x1b[0m\x1b[K: \x1b]8;;https://example.com\x07details\x1b]8;;\x1b\\\r\n";
  assert.equal(cleanOutput(text), "error: details\n");
  assert.equal(cleanOutput("old progress\rnew progress"), "new progress");
});

test("empty control-only events don't add noise; output stays bounded", () => {
  assert.equal(appendOutput("hello\n", "\x1b[0m"), "hello\n");
  assert.equal(appendOutput("a".repeat(150000), "line").length, 150000);
});

test("following pauses away from the bottom and resumes when scrolled back", () => {
  assert.equal(isAtOutputBottom(800, 1000, 200), true);
  assert.equal(isAtOutputBottom(777, 1000, 200), true);
  assert.equal(isAtOutputBottom(700, 1000, 200), false);
  assert.equal(isAtOutputBottom(0, 150, 200), true);
});
