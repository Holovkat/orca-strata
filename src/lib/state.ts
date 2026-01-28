import { readFile, readdir } from "fs/promises";
import { join } from "path";
import type { SprintStatus, Sprint, Shard, ColumnName, OrcaConfig } from "./types.js";
import { readShard } from "./shard.js";
import { listIssues, getIssue } from "./github.js";

/**
 * Derive sprint status from source of truth:
 * 1. GitHub Issues (labels/project board columns)
 * 2. Implementation checklists
 * 3. Shard files
 */
export async function deriveSprintStatus(
  projectPath: string,
  config: OrcaConfig
): Promise<SprintStatus | null> {
  // Scan for sprints in features folder
  const sprints = await scanForSprints(projectPath, config.paths.features);
  
  if (sprints.length === 0) {
    return null;
  }

  // For now, use the first/most recent sprint
  // TODO: Add sprint selection UI
  const sprint = sprints[0]!;

  // If GitHub tracking is enabled, sync status from issues
  if (config.tracking.mode === "github" || config.tracking.mode === "both") {
    await syncStatusFromGitHub(sprint);
  }

  // If local tracking is enabled, sync from checklist
  if (config.tracking.mode === "local" || config.tracking.mode === "both") {
    await syncStatusFromChecklist(projectPath, config.paths.features, sprint);
  }

  const counts = calculateCounts(sprint.shards);

  return {
    sprint,
    counts,
    activeDroids: [], // Active droids are runtime-only, not persisted
  };
}

/**
 * Scan features folder for sprint directories containing shards
 * Also checks features/sprints/ for backward compatibility
 */
export async function scanForSprints(
  projectPath: string,
  featuresPath: string
): Promise<Sprint[]> {
  const fullPath = join(projectPath, featuresPath);
  const sprints: Sprint[] = [];

  try {
    const entries = await readdir(fullPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        // Skip the 'sprints' folder itself, we'll scan it separately
        if (entry.name === "sprints") continue;
        
        const sprintPath = join(fullPath, entry.name);
        const shards = await scanShards(sprintPath, featuresPath, entry.name);

        if (shards.length > 0) {
          // Try to read checklist for sprint metadata
          const checklist = await readChecklist(sprintPath);
          
          sprints.push({
            id: `sprint-${entry.name}`,
            name: checklist?.name || formatSprintName(entry.name),
            branch: checklist?.branch || `feature/${entry.name}-base`,
            phase: checklist?.phase || "build",
            shards,
            board: checklist?.board,
            epicIssue: checklist?.epicIssue,
            sprintIssue: checklist?.sprintIssue,
          });
        }
      }
    }
    
    // Also check features/sprints/ for backward compatibility
    const sprintsPath = join(fullPath, "sprints");
    try {
      const sprintEntries = await readdir(sprintsPath, { withFileTypes: true });
      
      for (const entry of sprintEntries) {
        if (entry.isDirectory() && !entry.name.startsWith(".")) {
          const sprintPath = join(sprintsPath, entry.name);
          const shards = await scanShards(sprintPath, `${featuresPath}/sprints`, entry.name);

          if (shards.length > 0) {
            // Check if we already have this sprint from the main scan
            const existingIndex = sprints.findIndex(s => s.id === `sprint-${entry.name}`);
            if (existingIndex === -1) {
              const checklist = await readChecklist(sprintPath);
              
              sprints.push({
                id: `sprint-${entry.name}`,
                name: checklist?.name || formatSprintName(entry.name),
                branch: checklist?.branch || `feature/${entry.name}-base`,
                phase: checklist?.phase || "build",
                shards,
                board: checklist?.board,
                epicIssue: checklist?.epicIssue,
                sprintIssue: checklist?.sprintIssue,
              });
            }
          }
        }
      }
    } catch {
      // No sprints subfolder
    }
  } catch {
    // Features folder doesn't exist
  }

  return sprints;
}

/**
 * Scan a sprint directory for shard files
 */
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
            title: parsed.metadata.title || formatShardTitle(shardId),
            file: join(featuresPath, sprintName, entry.name),
            issueNumber: parsed.metadata.issueNumber,
            status: parsed.metadata.status || "Ready to Build",
            type: parsed.metadata.type,
            dependencies: parsed.metadata.dependencies,
            creates: parsed.metadata.creates,
          });
        }
      }
    }

    // Sort shards by ID (shard-01, shard-02, etc.)
    shards.sort((a, b) => a.id.localeCompare(b.id));
  } catch {
    // Can't read sprint folder
  }

  return shards;
}

/**
 * Read implementation checklist for sprint metadata
 */
interface ChecklistMeta {
  name: string;
  branch?: string;
  phase?: "planning" | "build" | "review" | "uat" | "user-acceptance" | "deploy";
  board?: string;
  epicIssue?: number;
  sprintIssue?: number;
}

async function readChecklist(sprintPath: string): Promise<ChecklistMeta | null> {
  const checklistPath = join(sprintPath, "00-IMPLEMENTATION-CHECKLIST.md");

  try {
    const content = await readFile(checklistPath, "utf-8");
    
    // Parse checklist header for metadata
    const nameMatch = content.match(/^#\s+(.+)/m);
    const branchMatch = content.match(/\*\*Branch\*\*:\s*`([^`]+)`/);
    const phaseMatch = content.match(/\*\*Phase\*\*:\s*(\w+)/i);
    const boardMatch = content.match(/\*\*Board\*\*:\s*#?(\d+)/);
    const epicMatch = content.match(/\*\*Epic\*\*:\s*#(\d+)/);
    const sprintMatch = content.match(/\*\*Sprint Issue\*\*:\s*#(\d+)/);

    return {
      name: nameMatch?.[1] || "Unknown Sprint",
      branch: branchMatch?.[1],
      phase: parsePhase(phaseMatch?.[1]),
      board: boardMatch?.[1],
      epicIssue: epicMatch?.[1] ? parseInt(epicMatch[1]) : undefined,
      sprintIssue: sprintMatch?.[1] ? parseInt(sprintMatch[1]) : undefined,
    };
  } catch {
    return null;
  }
}

function parsePhase(phase?: string): ChecklistMeta["phase"] | undefined {
  if (!phase) return undefined;
  const normalized = phase.toLowerCase();
  if (["planning", "build", "review", "uat", "user-acceptance", "deploy"].includes(normalized)) {
    return normalized as ChecklistMeta["phase"];
  }
  return undefined;
}

/**
 * Sync shard status from GitHub issue labels/project board
 */
async function syncStatusFromGitHub(sprint: Sprint): Promise<void> {
  for (const shard of sprint.shards) {
    if (shard.issueNumber) {
      try {
        const issue = await getIssue(shard.issueNumber);
        if (issue) {
          shard.status = deriveStatusFromIssue(issue);
        }
      } catch {
        // Issue not found or API error, keep existing status
      }
    }
  }
}

/**
 * Derive column status from GitHub issue labels
 */
function deriveStatusFromIssue(issue: { labels: string[]; state: "open" | "closed" }): ColumnName {
  const labels = issue.labels.map(l => l.toLowerCase());

  if (issue.state === "closed") {
    return "Done";
  }

  // Check for status labels (in order of precedence)
  if (labels.includes("user-acceptance")) return "User Acceptance";
  if (labels.includes("uat-in-progress")) return "UAT in Progress";
  if (labels.includes("ready-for-uat") || labels.includes("uat-pending")) return "Ready for UAT";
  if (labels.includes("in-review")) return "In Review";
  if (labels.includes("ready-for-review")) return "Ready for Review";
  if (labels.includes("in-progress")) return "In Progress";
  if (labels.includes("ready-to-build") || labels.includes("ready")) return "Ready to Build";

  // Default based on issue state
  return "Ready to Build";
}

/**
 * Sync shard status from implementation checklist
 */
async function syncStatusFromChecklist(
  projectPath: string,
  featuresPath: string,
  sprint: Sprint
): Promise<void> {
  const checklistPath = join(projectPath, featuresPath, sprint.name.toLowerCase().replace(/\s+/g, "-"), "00-IMPLEMENTATION-CHECKLIST.md");

  try {
    const content = await readFile(checklistPath, "utf-8");

    for (const shard of sprint.shards) {
      // Look for shard reference in checklist with checkbox status
      // Format: - [x] **shard-01**: Description
      // Or: - [ ] [shard-01](./shard-01.md): Description
      const shardPattern = new RegExp(
        `- \\[([ xX])\\].*${shard.id.replace(/-/g, "[-\\s]?")}`,
        "i"
      );
      const match = content.match(shardPattern);

      if (match) {
        const isComplete = match[1]?.toLowerCase() === "x";
        if (isComplete && shard.status === "Ready to Build") {
          // Checklist says done, but no GitHub status - mark as ready for review
          shard.status = "Ready for Review";
        }
      }
    }
  } catch {
    // Checklist not found
  }
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

function formatSprintName(dirName: string): string {
  return dirName
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatShardTitle(shardId: string): string {
  // shard-01-design-chat-architecture -> Design Chat Architecture
  return shardId
    .replace(/^shard-\d+-/, "")
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Refresh status from sources of truth
 * Call this when user wants to sync latest state
 */
export async function refreshStatus(
  projectPath: string,
  config: OrcaConfig,
  currentStatus: SprintStatus
): Promise<SprintStatus> {
  // Re-derive from sources
  const freshStatus = await deriveSprintStatus(projectPath, config);
  
  if (!freshStatus) {
    return currentStatus;
  }

  // Preserve runtime-only data (active droids)
  return {
    ...freshStatus,
    activeDroids: currentStatus.activeDroids,
  };
}

// Keep these for backward compatibility but they're now no-ops
export async function loadState(_projectPath: string): Promise<SprintStatus | null> {
  return null; // State is now derived, not loaded
}

export async function saveState(_projectPath: string, _status: SprintStatus | null): Promise<void> {
  // No-op - state is derived from GitHub/checklists, not persisted separately
}
