import assert from "node:assert/strict";
import test from "node:test";
import { appendBuildProblem, decodeBuildLine, formatBuildOutput } from "../src/lib/buildDiagnostics.ts";

test("Cargo compiler JSON preserves a primary span and artifact path", () => {
  const message = JSON.stringify({
    reason: "compiler-message",
    message: { level: "error", message: "cannot find value `missing` in this scope",
      code: { code: "E0425" }, rendered: "error[E0425]: cannot find value `missing`",
      spans: [{ file_name: "src/main.rs", line_start: 7, column_start: 9, is_primary: true }] },
  });
  const decoded = decodeBuildLine(message, "/workspace/rust-app");
  assert.deepEqual(decoded.problem, {
    file: "/workspace/rust-app/src/main.rs", line: 7, column: 9,
    severity: "error", message: "cannot find value `missing` in this scope", code: "E0425",
  });
  assert.equal(decoded.display, "error[E0425]: cannot find value `missing`");
  assert.equal(decodeBuildLine('{"reason":"compiler-artifact","executable":"/tmp/app"}', "/tmp").artifact, "/tmp/app");
});

test("Rust styling is stripped while source lines, spans and error codes survive", () => {
  const rendered = "\u001b[1;31merror[E0425]\u001b[0m: cannot find value `missing`\n --> src/main.rs:7:9\n  |\n7 | missing\n  | ^^^^^^^\n";
  const raw = JSON.stringify({ reason: "compiler-message", message: { level: "error", message: "cannot find value `missing`",
    code: { code: "E0425" }, rendered, spans: [{ file_name: "src/main.rs", line_start: 7, column_start: 9, is_primary: true }] } });
  const decoded = decodeBuildLine(raw, "/workspace/app");
  assert.ok(!decoded.display.includes("\u001b"));
  assert.ok(decoded.display.includes("7 | missing"));
  assert.equal(decoded.problem.code, "E0425");
  assert.equal(decoded.problem.file, "/workspace/app/src/main.rs");
});

test("parked Rust output hides Cargo metadata without hiding application JSON", () => {
  const text = [
    '{"reason":"compiler-artifact","executable":"/tmp/app"}',
    JSON.stringify({ reason: "compiler-message", message: { rendered: "warning: unused variable\n" } }),
    '{"reason":"build-script-executed","out_dir":"/tmp/build"}',
    '{"reason":"build-finished","success":true}',
    '{"reason":"application-event","value":42}',
    'Finished dev profile',
  ].join("\n");
  assert.equal(formatBuildOutput(text), 'warning: unused variable\n{"reason":"application-event","value":42}\nFinished dev profile');
});

test("the reported C++ error remains navigable through a workspace build plan", () => {
  const text = "/workspace/GUI Applications/lab/Native/math.cpp:2:19: error: ‘righ’ was not declared in this scope; did you mean ‘right’?";
  const problem = decodeBuildLine(text, "/workspace/GUI Applications/lab").problem;
  assert.equal(problem.file, "/workspace/GUI Applications/lab/Native/math.cpp");
  assert.equal(problem.line, 2);
  assert.equal(problem.column, 19);
  assert.equal(problem.severity, "error");
  const problems = appendBuildProblem([], problem);
  assert.equal(appendBuildProblem(problems, { ...problem }), problems);
  assert.equal(appendBuildProblem(problems, { ...problem, line: 3 }).length, 2);
});

test("MSBuild and Clang errors navigate to paths with spaces", () => {
  const csharp = decodeBuildLine(
    "/home/user/My App/Program.cs(12,8): error CS1002: ; expected [/home/user/My App/App.csproj]",
    "/home/user/My App",
  );
  assert.deepEqual(csharp.problem, {
    file: "/home/user/My App/Program.cs", line: 12, column: 8,
    severity: "error", code: "CS1002", message: "; expected",
  });
  const cpp = decodeBuildLine("src/main.cpp:4:11: warning: unused variable 'x'", "/workspace/cpp app");
  assert.deepEqual(cpp.problem, {
    file: "/workspace/cpp app/src/main.cpp", line: 4, column: 11,
    severity: "warning", message: "unused variable 'x'",
  });
});
