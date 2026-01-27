import { readFile } from "fs/promises";
import { join } from "path";
import { parse } from "yaml";
import { DEFAULT_CONFIG, type OrcaConfig } from "./types.js";

export async function loadConfig(
  projectPath: string,
  configFileName: string
): Promise<OrcaConfig> {
  const configPath = join(projectPath, configFileName);

  try {
    const content = await readFile(configPath, "utf-8");
    const parsed = parse(content) as Partial<OrcaConfig>;
    return mergeConfig(DEFAULT_CONFIG, parsed);
  } catch (error) {
    // Config file doesn't exist, return defaults
    return DEFAULT_CONFIG;
  }
}

function mergeConfig(
  defaults: OrcaConfig,
  overrides: Partial<OrcaConfig>
): OrcaConfig {
  return {
    ...defaults,
    ...overrides,
    tracking: {
      ...defaults.tracking,
      ...overrides.tracking,
    },
    paths: {
      ...defaults.paths,
      ...overrides.paths,
    },
    droids: {
      ...defaults.droids,
      ...overrides.droids,
    },
    branching: {
      ...defaults.branching,
      ...overrides.branching,
    },
    columns: overrides.columns ?? defaults.columns,
  };
}

export async function saveConfig(
  projectPath: string,
  configFileName: string,
  config: OrcaConfig
): Promise<void> {
  const { stringify } = await import("yaml");
  const { writeFile } = await import("fs/promises");
  const configPath = join(projectPath, configFileName);
  await writeFile(configPath, stringify(config), "utf-8");
}
