import assert from "node:assert/strict";
import test from "node:test";
import { decodeBuildLine } from "../src/lib/buildDiagnostics.ts";

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
