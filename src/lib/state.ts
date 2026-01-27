import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import type { SprintStatus, Sprint, Shard, ColumnName } from "./types.js";
import { readShard } from "./shard.js";
import { readdir } from "fs/promises";

const STATE_FILE = ".orca-state.json";

interface PersistedState {
  currentSprint: Sprint | null;
  activeDroids: Array<{
    shardId: string;
    droid: string;
    status: "running" | "complete" | "failed";
    startedAt: string;
  }>;
}

export async function loadState(projectPath: string): Promise<SprintStatus | null> {
  const statePath = join(projectPath, STATE_FILE);

  try {
    const content = await readFile(statePath, "utf-8");
    const state: PersistedState = JSON.parse(content);

    if (!state.currentSprint) {
      return null;
    }

    const counts = calculateCounts(state.currentSprint.shards);

    return {
      sprint: state.currentSprint,
      counts,
      activeDroids: state.activeDroids.map((d) => ({
        ...d,
        startedAt: new Date(d.startedAt),
      })),
    };
  } catch {
    // No state file or invalid - try to scan features folder
    return null;
  }
}

export async function saveState(
  projectPath: string,
  status: SprintStatus | null
): Promise<void> {
  const statePath = join(projectPath, STATE_FILE);

  const state: PersistedState = {
    currentSprint: status?.sprint || null,
    activeDroids:
      status?.activeDroids.map((d) => ({
        ...d,
        startedAt: d.startedAt.toISOString(),
      })) || [],
  };

  await writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");
}

export async function scanForSprints(
  projectPath: string,
  featuresPath: string
): Promise<Sprint[]> {
  const fullPath = join(projectPath, featuresPath);
  const sprints: Sprint[] = [];

  try {
    const entries = await readdir(fullPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const sprintPath = join(fullPath, entry.name);
        const shards = await scanShards(sprintPath, featuresPath, entry.name);

        if (shards.length > 0) {
          sprints.push({
            id: `sprint-${entry.name}`,
            name: entry.name,
            branch: `feature/${entry.name}-base`,
            phase: "build",
            shards,
          });
        }
      }
    }
  } catch {
    // Features folder doesn't exist
  }

  return sprints;
}

async function scanShards(
  sprintPath: string,
  featuresPath: string,
  sprintName: string
): Promise<Shard[]> {
  const shards: Shard[] = [];

  try {
    const entries = await readdir(sprintPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".md") && entry.name.startsWith("shard-")) {
        const shardPath = join(sprintPath, entry.name);
        const parsed = await readShard(shardPath);

        if (parsed) {
          const shardId = entry.name.replace(".md", "");
          shards.push({
            id: shardId,
            title: parsed.metadata.title || shardId,
            file: join(featuresPath, sprintName, entry.name),
            issueNumber: parsed.metadata.issueNumber,
            status: parsed.metadata.status || ("Ready to Build" as ColumnName),
            type: parsed.metadata.type,
            dependencies: parsed.metadata.dependencies,
            creates: parsed.metadata.creates,
          });
        }
      }
    }
  } catch {
    // Can't read sprint folder
  }

  return shards;
}

function calculateCounts(shards: Shard[]) {
  return {
    total: shards.length,
    readyToBuild: shards.filter((s) => s.status === "Ready to Build").length,
    inProgress: shards.filter((s) => s.status === "In Progress").length,
    readyForReview: shards.filter((s) => s.status === "Ready for Review").length,
    inReview: shards.filter((s) => s.status === "In Review").length,
    readyForUat: shards.filter((s) => s.status === "Ready for UAT").length,
    uatInProgress: shards.filter((s) => s.status === "UAT in Progress").length,
    userAcceptance: shards.filter((s) => s.status === "User Acceptance").length,
    done: shards.filter((s) => s.status === "Done").length,
  };
}
