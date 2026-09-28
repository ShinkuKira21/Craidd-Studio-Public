import type { ConfigEntry, CraiddProject, CraiddSolution, LinkedLaunch } from "../types/project";

export interface LinkedStartupSuggestion {
  serverProjectPath: string;
  serverProjectName: string;
  clientProjectNames: string[];
  configurationNames: string[];
  clientConfigurationNames: string[];
  baseUrl: string;
  readyUrl: string;
  evidence: string[];
}

function localHttpOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "0.0.0.0"].includes(url.hostname)) return null;
    url.hostname = "127.0.0.1";
    return url.origin;
  } catch { return null; }
}

function urlsIn(values: string[]): string[] {
  return [...new Set(values.flatMap((value) => value.match(/http:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0):\d+/g) ?? [])
    .map(localHttpOrigin).filter((url): url is string => !!url))];
}

function manifestStrings(project: CraiddProject, key: string): string[] {
  return (project.manifests ?? []).flatMap((manifest) => Array.isArray(manifest.values[key]) ? manifest.values[key].map(String) : []);
}

function configOrigins(config: ConfigEntry): string[] {
  return urlsIn([config.command ?? "", ...(config.profiles ?? []).flatMap((profile) => [
    ...profile.args, profile.env.ASPNETCORE_URLS ?? "", profile.env.DOTNET_URLS ?? "",
  ])]);
}

export function detectLinkedStartupSuggestions(solution: CraiddSolution, configs: ConfigEntry[]): LinkedStartupSuggestion[] {
  const clients = solution.projects.filter((project) => manifestStrings(project, "referencedUrls").length > 0);
  const suggestions: LinkedStartupSuggestion[] = [];
  for (const server of solution.projects.filter((project) => (project.manifests ?? [])
    .some((manifest) => manifest.kind === "dotnet" && manifest.values.sdk === "Microsoft.NET.Sdk.Web"))) {
    const serverConfigs = configs.filter((config) => config.target === server.path && ["run", "debug"].includes(config.kind)
      && config.method === "dotnet" && !config.slots && !config.linked?.readyUrl);
    const origins = [...new Set([...serverConfigs.flatMap(configOrigins), ...urlsIn(manifestStrings(server, "launchUrls"))])];
    for (const baseUrl of origins) {
      const matchedClients = clients.filter((project) => project.path !== server.path
        && urlsIn(manifestStrings(project, "referencedUrls")).includes(baseUrl));
      if (matchedClients.length === 0) continue;
      const configuredKinds = new Set(configs.filter((config) => config.target === server.path && config.linked?.readyUrl
        && localHttpOrigin(config.linked.readyUrl) === baseUrl).map((config) => config.kind));
      const matchingConfigs = serverConfigs.filter((config) => {
        const declared = configOrigins(config);
        // Multi-port profiles need individual setup; never apply one health
        // URL indiscriminately to alternate server configurations.
        return !configuredKinds.has(config.kind) && (declared.length === 0 || (declared.length === 1 && declared[0] === baseUrl));
      });
      const matchingKinds = new Set(matchingConfigs.map((config) => config.kind));
      const clientNames = configs.filter((config) => matchedClients.some((project) => project.path === config.target)
        && matchingKinds.has(config.kind) && !config.slots).map((config) => config.name);
      if (matchingConfigs.length === 0 || clientNames.length === 0) continue;
      const path = manifestStrings(server, "readinessPaths")[0];
      suggestions.push({
        serverProjectPath: server.path, serverProjectName: server.name,
        clientProjectNames: matchedClients.map((project) => project.name),
        configurationNames: matchingConfigs.map((config) => config.name), clientConfigurationNames: clientNames,
        baseUrl, readyUrl: path ? `${baseUrl}${path}` : "",
        evidence: ["ASP.NET Web SDK", `server and client both reference ${baseUrl}`, ...(path ? [`health route ${path} in Program.cs`] : [])],
      });
    }
  }
  return suggestions;
}

export function cloneStartupConfig(config: ConfigEntry): ConfigEntry {
  return { ...config, ...(config.linked ? { linked: { ...config.linked } } : {}),
    ...(config.slots ? { slots: { ...config.slots } } : {}),
    profiles: config.profiles?.map((profile) => ({ ...profile, args: [...profile.args], env: { ...profile.env } })) ?? [] };
}

export function applyLinkedStartupSetup(
  drafts: ConfigEntry[], inferred: ConfigEntry[], serverNames: string[], clientNames: string[],
  serverPolicy: LinkedLaunch, clientPriority: number, baseUrl: string,
): { configs: ConfigEntry[]; firstServerName: string | undefined } {
  const configs = drafts.map(cloneStartupConfig);
  const used = new Set([...configs, ...inferred].map((config) => config.name.toLowerCase()));
  let firstServerName: string | undefined;
  for (const name of [...serverNames, ...clientNames]) {
    let target = configs.find((config) => config.name === name);
    if (!target) {
      const source = inferred.find((config) => config.name === name);
      if (!source) continue;
      target = cloneStartupConfig(source);
      const base = `${source.name} Linked`;
      let suffix = 2;
      target.name = base;
      while (used.has(target.name.toLowerCase())) target.name = `${base} ${suffix++}`;
      used.add(target.name.toLowerCase());
      target.origin = "user";
      target.bestFit = false;
      target.relatedProjects = [];
      configs.push(target);
    }
    if (serverNames.includes(name)) {
      target.linked = { ...serverPolicy };
      firstServerName ??= target.name;
      // DAP launches bypass launchSettings.json. Pin its detected binding in
      // the explicit saved profile when no command/profile already declares it.
      if (configOrigins(target).length === 0) {
        if (!target.profiles?.length) target.profiles = [{ name: "Debug", args: [], env: {} }];
        target.defaultProfile ??= target.profiles[0].name;
        target.profiles = target.profiles.map((profile) => ({ ...profile, env: { ...profile.env, ASPNETCORE_URLS: baseUrl } }));
      }
    } else {
      target.linked = { ...(target.linked ?? { timeoutMs: 30_000 }), priority: clientPriority };
    }
  }
  return { configs, firstServerName };
}
