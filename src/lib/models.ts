import { readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

export interface CustomModel {
  id: string;
  displayName: string;
  model: string;
  provider?: string;
}

export interface FactorySettings {
  customModels?: Array<{
    id: string;
    displayName: string;
    model: string;
    provider?: string;
    baseUrl?: string;
    maxOutputTokens?: number;
  }>;
}

// Built-in models available without custom configuration
export const BUILTIN_MODELS = [
  { id: "claude-sonnet-4-5-20250929", displayName: "Claude Sonnet 4.5" },
  { id: "claude-opus-4-20250514", displayName: "Claude Opus 4" },
  { id: "claude-3-5-haiku-20241022", displayName: "Claude 3.5 Haiku" },
];

/**
 * Load custom models from Factory settings.json
 */
export async function loadCustomModels(): Promise<CustomModel[]> {
  const settingsPath = join(homedir(), ".factory", "settings.json");

  try {
    const content = await readFile(settingsPath, "utf-8");
    const settings: FactorySettings = JSON.parse(content);

    if (!settings.customModels || !Array.isArray(settings.customModels)) {
      return [];
    }

    return settings.customModels.map((m) => ({
      id: m.id,
      displayName: m.displayName || m.model,
      model: m.model,
      provider: m.provider,
    }));
  } catch {
    return [];
  }
}

/**
 * Get all available models (builtin + custom)
 */
export async function getAllModels(): Promise<CustomModel[]> {
  const customModels = await loadCustomModels();

  const allModels: CustomModel[] = [
    ...BUILTIN_MODELS.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      model: m.id,
    })),
    ...customModels,
  ];

  return allModels;
}

/**
 * Find a model by ID
 */
export async function findModel(id: string): Promise<CustomModel | null> {
  const allModels = await getAllModels();
  return allModels.find((m) => m.id === id) || null;
}

/**
 * Check if a model ID is a custom model
 */
export function isCustomModel(id: string): boolean {
  return id.startsWith("custom:");
}
