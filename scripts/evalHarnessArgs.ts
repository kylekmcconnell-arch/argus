export interface EvalHarnessArgs {
  subjects: string[];
  flags: Set<string>;
  allowLiveHosts?: string[];
  forceLiveHosts?: string[];
  forceLiveTools?: string[];
}

const hostList = (value: string | undefined, option: string): string[] => {
  const hosts = value?.split(",").map((host) => host.trim()).filter(Boolean) ?? [];
  if (!hosts.length) throw new Error(`${option} requires a comma-separated host list`);
  return hosts;
};

/**
 * Parse replay flags without treating a spaced option value as a subject.
 * Both `--allow-live hosts` and `--allow-live=hosts` remain supported.
 */
export function parseEvalHarnessArgs(args: readonly string[]): EvalHarnessArgs {
  const subjects: string[] = [];
  const flags = new Set<string>();
  let allowLiveHosts: string[] | undefined;
  let forceLiveHosts: string[] | undefined;
  let forceLiveTools: string[] | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const option = arg.split("=", 1)[0];
    if (option === "--allow-live" || option === "--force-live" || option === "--force-live-tool") {
      flags.add(option);
      const inlineValue = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : undefined;
      const value = inlineValue ?? args[index + 1];
      if (inlineValue === undefined && value?.startsWith("--")) {
        throw new Error(`${option} requires a comma-separated value`);
      }
      if (inlineValue === undefined) index += 1;
      const values = hostList(value, option);
      if (option === "--allow-live") allowLiveHosts = values;
      else if (option === "--force-live") forceLiveHosts = values;
      else forceLiveTools = values;
      continue;
    }
    if (arg.startsWith("--")) {
      flags.add(arg);
      continue;
    }
    subjects.push(arg);
  }

  return {
    subjects,
    flags,
    ...(allowLiveHosts ? { allowLiveHosts } : {}),
    ...(forceLiveHosts ? { forceLiveHosts } : {}),
    ...(forceLiveTools ? { forceLiveTools } : {}),
  };
}
