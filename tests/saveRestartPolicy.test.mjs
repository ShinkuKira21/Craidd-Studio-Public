import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/saveRestartPolicy.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
} });
const { saveRestartPlan, restartLabel } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

const project = (name, folder) => ({ name, folder, path: `${folder}/${name}.craidd` });
const config = (name, folder, extra = {}) => ({ name, kind: "run", target: `${folder}/${folder}.craidd`, ...extra });
const solution = {
  root: "/lab", projects: [project("Client", "Client"), project("Server", "Server"), project("Native", "Native")],
  inferredConfigs: [], configs: [config("Client · Local", "Client"), config("API · Local", "Server"),
    config("Native · Scalar", "Native", { kind: "build" })],
};
function member(label, name, action = "debug", extra = {}) {
  return { windowLabel: label, windowId: 1, instanceId: label, selectedConfigName: name,
    selectedProfileName: null, status: "running", activeAction: action, debugging: action === "debug", ldiRole: null, ...extra };
}
function linked(windows, action = "debug") {
  return { windows, members: windows, activeAction: action, activeActionId: action ? 17 : null };
}

test("one server file proposes White restart while eight clients keep running", () => {
  const server = member("api", "API · Local");
  const windows = [server, ...Array.from({ length: 8 }, (_, i) => member(`client${i}`, "Client · Local"))];
  const plan = saveRestartPlan("/lab/Server/Program.cs", solution, linked(windows));
  assert.equal(plan.scope, "white");
  assert.deepEqual(plan.targets.map((item) => item.windowLabel), ["api"]);
  assert.equal(restartLabel(plan), "White Restart Debug");
});

test("shared client source proposes Gold restart and names every affected window", () => {
  const windows = [member("api", "API · Local", "run"),
    ...Array.from({ length: 8 }, (_, i) => member(`client${i}`, "Client · Local", "run"))];
  const plan = saveRestartPlan("/lab/Client/src/main.rs", solution, linked(windows, "run"));
  assert.equal(plan.scope, "gold");
  assert.equal(plan.targets.length, 9);
  assert.equal(plan.affected.length, 8);
  assert.equal(plan.actionId, 17);
  assert.equal(restartLabel(plan), "Gold Restart Run");
});

test("a waiting native LDI partner requires Gold restart with the managed host and unrelated client", () => {
  const windows = [member("api", "API · Local", "debug", { ldiRole: "managed" }),
    member("native", "Native · Scalar", "debug", { ldiRole: "native-library", status: "waiting", debugging: false }),
    member("client", "Client · Local")];
  for (const file of ["/lab/Native/scalar.cpp", "/lab/Server/MainWindow.cs"]) {
    const plan = saveRestartPlan(file, solution, linked(windows));
    assert.equal(plan.scope, "gold");
    assert.equal(plan.targets.length, 3);
    assert.equal(restartLabel(plan), "Gold Restart Debug");
  }
});

test("build dependencies attach a native source to the running managed configuration", () => {
  const composed = { ...solution, configs: [config("API · Local", "Server", { slots: { build: "Prepare", debug: "API Debug" } }),
    { name: "Prepare", kind: "build", method: "plan", target: ".", order: { steps: [{ kind: "build", configuration: "Native Build" }] } },
    config("Native Build", "Native", { kind: "build", method: "cmake" }), config("API Debug", "Server", { kind: "debug" })] };
  const windows = [member("api", "API · Local"), member("client", "Client · Local")];
  const plan = saveRestartPlan("/lab/Native/scalar.cpp", composed, linked(windows));
  assert.equal(plan.scope, "white");
  assert.deepEqual(plan.targets.map((item) => item.windowLabel), ["api"]);
});

test("independent Rust debugging and nested project ownership do not restart unrelated windows", () => {
  const nested = { ...solution, projects: [...solution.projects, project("Rust", ".")],
    configs: [...solution.configs, { name: "Rust · Local", kind: "debug", target: "./Rust.craidd" }] };
  const windows = [member("rust", "Rust · Local"), member("api", "API · Local")];
  const state = { ...linked(windows, null), members: [] };
  assert.equal(saveRestartPlan("/lab/src/main.rs", nested, state).targets[0].windowLabel, "rust");
  assert.deepEqual(saveRestartPlan("/lab/Server/Program.cs", nested, state).targets.map((item) => item.windowLabel), ["api"]);
  assert.equal(saveRestartPlan("/lab/README.md", nested, state), null);
  assert.equal(saveRestartPlan("/elsewhere/src/main.rs", nested, state), null);
});

test("mixed independent run and debug sessions preserve their individual actions", () => {
  const state = { ...linked([member("debug", "Client · Local"), member("run", "Client · Local", "run")], null), members: [] };
  const plan = saveRestartPlan("/lab/Client/src/main.rs", solution, state);
  assert.equal(plan.scope, "white");
  assert.deepEqual(plan.targets.map((item) => item.action), ["debug", "run"]);
  assert.equal(restartLabel(plan), "Restart 2 Processes");
});

test("saving unrelated files or while only building does not offer process restart", () => {
  const state = linked([member("api", "API · Local", "build")], "build");
  assert.equal(saveRestartPlan("/lab/Server/Program.cs", solution, state), null);
  assert.equal(saveRestartPlan("/lab/Native/scalar.cpp", solution, linked([member("api", "API · Local")])), null);
});
