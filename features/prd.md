# Legacy Project Adapter - Implementation Specification

## Problem
Orca expects flat sprint folders with `shard-*.md` files. Legacy projects like `fms-glm` use nested phase/sprint structures with various naming conventions.

## Solution
Auto-detect legacy structures and map phase folders to Orca sprints, treating any `.md` file (except known non-shards) as a shard.

## Key Behaviors

1. **Auto-detection**: If no `.orchestrator.yaml` exists, scan `features/` for phase folders
2. **Phase = Sprint**: Each phase folder (e.g., `pY-operations-excellence/`) becomes a sprint
3. **Shard discovery**: Any `.md` file except `README.md`, `AGENTS.md`, `index.md`, `*CHECKLIST*.md`
4. **Status parsing**: Extract `[x]`/`[ ]` from checklists to derive shard status

## New File: `src/lib/legacy-discovery.ts`

```typescript
export async function detectLegacyProject(projectPath: string): Promise<boolean>
// Returns true if no .orchestrator.yaml OR has pX-* phase folders

export async function discoverLegacySprints(
  projectPath: string, 
  featuresPath: string
): Promise<Sprint[]>
// Scans features/ for phase folders, returns them as Sprint objects

export async function discoverShards(phasePath: string): Promise<Shard[]>
// Finds all .md files recursively, excludes non-shards

export function parseChecklistStatus(content: string): Map<string, ColumnName>
// Parses [x]/[ ] markers, maps to Orca columns
```

## Modified: `src/lib/state.ts`

Update `scanForSprints()`:
1. Call `detectLegacyProject()`
2. If legacy, use `discoverLegacySprints()` instead of current logic
3. Look for checklists at: `features/{phase}/00-PHASE-CHECKLIST.md`, `features/{phase}/00-IMPLEMENTATION-CHECKLIST.md`

## Modified: `src/lib/config.ts`

Add `generateConfigFromDiscovery()`:
- Creates minimal config from discovered project structure
- Sets `project_name` from folder name
- Sets `paths.features` to `features/`

## Status Mapping

| Checklist Pattern | Orca Column |
|-------------------|-------------|
| `- [ ]` | Ready to Build |
| `- [x]` | Done |
| `✅ Complete` | Done |
| `🔄 In Progress` | In Progress |

## Shard Exclusions
- `README.md`, `AGENTS.md`, `index.md`
- `*CHECKLIST*.md`, `qa-approval.md`, `SKILL.md`

## Effort
~13 story points across 2 sprints