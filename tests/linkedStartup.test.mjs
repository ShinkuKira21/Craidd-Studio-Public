import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Exercise the actual pure TypeScript helpers without adding a test runner.
const source = await readFile(new URL("../src/lib/linkedStartup.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { detectLinkedStartupSuggestions: detect, applyLinkedStartupSetup: apply, renameConfigurationReferences: rename } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

const profile = (url) => ({ name: "Local", args: [], env: url ? { ASPNETCORE_URLS: url } : {} });
const config = (name, target, kind = "run", url) => ({ name, target, kind, method: target === "api" ? "dotnet" : "cargo", origin: "user", profiles: [profile(url)] });
const fixture = () => ({ projects: [
  { path: "api", name: "API", manifests: [{ kind: "dotnet", values: { sdk: "Microsoft.NET.Sdk.Web", launchUrls: ["http://localhost:5087"], readinessPaths: ["/api/health"] } }] },
  { path: "client", name: "Tauri", manifests: [{ kind: "cargo", values: { referencedUrls: ["http://127.0.0.1:5087/api/items"] } }] },
] });

test("suggests an order only when the API and client reference the same local port", () => {
  const solution = fixture();
  const configs = [config("API Run", "api"), config("Tauri Run", "client")];
  const [suggestion] = detect(solution, configs);
  assert.equal(suggestion.readyUrl, "http://127.0.0.1:5087/api/health");
  assert.deepEqual(suggestion.configurationNames, ["API Run"]);
  assert.deepEqual(suggestion.clientConfigurationNames, ["Tauri Run"]);
  solution.projects[1].manifests[0].values.referencedUrls = ["http://127.0.0.1:9999/api/items"];
  assert.deepEqual(detect(solution, configs), []);
});

test("does not invent health endpoints or suggest alternate-port/multi-port configs", () => {
  const solution = fixture();
  solution.projects[0].manifests[0].values.readinessPaths = [];
  const [suggestion] = detect(solution, [config("Local", "api"), config("Other", "api", "run", "http://localhost:6000"),
    config("Multi", "api", "run", "http://localhost:5087;http://localhost:6000"), config("Client", "client")]);
  assert.equal(suggestion.readyUrl, "");
  assert.deepEqual(suggestion.configurationNames, ["Local"]);
});

test("configured Run does not suppress a still-unconfigured Debug setup", () => {
  const run = config("API Run", "api");
  run.linked = { priority: 20, readyUrl: "http://localhost:5087/api/health", timeoutMs: 30000 };
  const [suggestion] = detect(fixture(), [run, config("API Debug", "api", "debug"), config("Client Run", "client"), config("Client Debug", "client", "debug")]);
  assert.deepEqual(suggestion.configurationNames, ["API Debug"]);
  assert.deepEqual(suggestion.clientConfigurationNames, ["Client Debug"]);
  assert.deepEqual(detect(fixture(), [run, config("Client Run", "client")]), []);
});

test("applying setup changes only selected drafts and preserves source profiles", () => {
  const drafts = [config("API", "api", "debug", "http://localhost:5087"), config("Other", "api", "debug", "http://localhost:6000"), config("Client", "client", "debug")];
  drafts[0].profiles[0].args = ["--project", "Api.csproj", "--no-launch-profile"];
  drafts[2].linked = { priority: 5, readyUrl: "http://localhost:3000/health", timeoutMs: 45000 };
  const original = structuredClone(drafts);
  const policy = { priority: 20, readyUrl: "http://127.0.0.1:5087/api/health", timeoutMs: 30000 };
  const { configs } = apply(drafts, [], ["API"], ["Client"], policy, 50, "http://127.0.0.1:5087");
  assert.deepEqual(drafts, original);
  assert.deepEqual(configs[0].profiles, original[0].profiles);
  assert.deepEqual(configs[1], original[1]);
  assert.deepEqual(configs[2].linked, { ...original[2].linked, priority: 50, after: ["api"] });
  assert.deepEqual(configs[0].linked, policy);
  configs[0].profiles[0].args.push("new");
  assert.deepEqual(drafts, original);
});

test("inferred configs become uniquely named saved copies with explicit API debug bindings", () => {
  const inferred = config("API Debug", "api", "debug");
  inferred.origin = "inferred";
  inferred.bestFit = true;
  inferred.relatedProjects = ["api"];
  inferred.profiles[0].env.EXTRA = "preserved";
  const original = structuredClone(inferred);
  const policy = { priority: 20, readyUrl: "http://127.0.0.1:5087/api/health", timeoutMs: 30000 };
  const { configs, firstServerName } = apply([config("API Debug Linked", "api")], [inferred], [inferred.name], [], policy, 50, "http://127.0.0.1:5087");
  assert.equal(firstServerName, "API Debug Linked 2");
  assert.equal(configs[1].origin, "user");
  assert.equal(configs[1].bestFit, false);
  assert.deepEqual(configs[1].relatedProjects, []);
  assert.deepEqual(configs[1].profiles[0].env, { EXTRA: "preserved", ASPNETCORE_URLS: "http://127.0.0.1:5087" });
  assert.deepEqual(inferred, original);
});

test("clients depend on every selected inferred server, not only the first", () => {
  const servers = [config("API A", "api-a"), config("API B", "api-b")].map((entry) => ({ ...entry, origin: "inferred" }));
  const { configs } = apply([config("Client", "client")], servers, ["API A", "API B"], ["Client"],
    { priority: 20, timeoutMs: 30000 }, 50, "http://127.0.0.1:5087");
  assert.deepEqual(configs[0].linked.after, ["api-a", "api-b"]);
});

test("renaming updates preparation, steps, install destinations and Power slots without mutating drafts", () => {
  const entry = { ...config("Combined", "."), slots: { build: "Old", debug: "Other" },
    order: { before: "Old", steps: [{ kind: "build", configuration: "Old" },
      { kind: "install", configuration: "Native", destination: "Old" }] } };
  const original = structuredClone(entry);
  const next = rename(entry, "Old", "New");
  assert.equal(next.slots.build, "New");
  assert.equal(next.slots.debug, "Other");
  assert.equal(next.order.before, "New");
  assert.equal(next.order.steps[0].configuration, "New");
  assert.equal(next.order.steps[1].destination, "New");
  assert.deepEqual(entry, original);
});
