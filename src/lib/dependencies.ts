import type { Shard } from "./types.js";

export interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  executionOrder: string[];
  parallelGroups: string[][];
}

export interface DependencyNode {
  shardId: string;
  creates: Set<string>;
  dependsOn: Set<string>;
  modifies: Set<string>;
  blockedBy: Set<string>;
  canRunParallelWith: Set<string>;
}

export function buildDependencyGraph(shards: Shard[]): DependencyGraph {
  const nodes = new Map<string, DependencyNode>();

  // Build nodes with their creates/depends/modifies
  for (const shard of shards) {
    nodes.set(shard.id, {
      shardId: shard.id,
      creates: new Set(shard.creates),
      dependsOn: new Set(shard.dependencies),
      modifies: new Set(), // Will be populated during analysis
      blockedBy: new Set(),
      canRunParallelWith: new Set(),
    });
  }

  // Analyze dependencies between shards
  for (const [shardId, node] of nodes) {
    for (const [otherShardId, otherNode] of nodes) {
      if (shardId === otherShardId) continue;

      // Check if this shard depends on something the other creates
      for (const dep of node.dependsOn) {
        if (otherNode.creates.has(dep)) {
          node.blockedBy.add(otherShardId);
        }
      }

      // Check for file modification conflicts
      for (const mod of node.modifies) {
        if (otherNode.modifies.has(mod)) {
          // Both modify same file - need sequential execution
          // The one with more dependencies goes second
          if (node.dependsOn.size >= otherNode.dependsOn.size) {
            node.blockedBy.add(otherShardId);
          }
        }
      }
    }
  }

  // Determine parallel groups
  const parallelGroups = computeParallelGroups(nodes);
  
  // Compute execution order (topological sort)
  const executionOrder = topologicalSort(nodes);

  // Mark which shards can run in parallel
  for (const group of parallelGroups) {
    for (const shardId of group) {
      const node = nodes.get(shardId);
      if (node) {
        for (const otherShardId of group) {
          if (shardId !== otherShardId) {
            node.canRunParallelWith.add(otherShardId);
          }
        }
      }
    }
  }

  return {
    nodes,
    executionOrder,
    parallelGroups,
  };
}

function computeParallelGroups(nodes: Map<string, DependencyNode>): string[][] {
  const groups: string[][] = [];
  const assigned = new Set<string>();

  // Group shards by their dependency depth
  const depths = new Map<string, number>();
  
  for (const [shardId, node] of nodes) {
    depths.set(shardId, computeDepth(shardId, nodes, new Set()));
  }

  // Group by depth level
  const maxDepth = Math.max(...depths.values());
  
  for (let depth = 0; depth <= maxDepth; depth++) {
    const group: string[] = [];
    
    for (const [shardId, d] of depths) {
      if (d === depth && !assigned.has(shardId)) {
        group.push(shardId);
        assigned.add(shardId);
      }
    }
    
    if (group.length > 0) {
      groups.push(group);
    }
  }

  return groups;
}

function computeDepth(
  shardId: string,
  nodes: Map<string, DependencyNode>,
  visited: Set<string>
): number {
  if (visited.has(shardId)) {
    return 0; // Cycle detected, break
  }
  
  visited.add(shardId);
  const node = nodes.get(shardId);
  
  if (!node || node.blockedBy.size === 0) {
    return 0;
  }

  let maxBlockerDepth = 0;
  
  for (const blockerId of node.blockedBy) {
    const blockerDepth = computeDepth(blockerId, nodes, new Set(visited));
    maxBlockerDepth = Math.max(maxBlockerDepth, blockerDepth);
  }

  return maxBlockerDepth + 1;
}

function topologicalSort(nodes: Map<string, DependencyNode>): string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  const temp = new Set<string>();

  function visit(shardId: string) {
    if (visited.has(shardId)) return;
    if (temp.has(shardId)) {
      // Cycle detected - skip (will be handled as parallel)
      return;
    }

    temp.add(shardId);
    
    const node = nodes.get(shardId);
    if (node) {
      for (const blockerId of node.blockedBy) {
        visit(blockerId);
      }
    }

    temp.delete(shardId);
    visited.add(shardId);
    result.push(shardId);
  }

  for (const shardId of nodes.keys()) {
    visit(shardId);
  }

  return result;
}

export function getShardsReadyToRun(
  graph: DependencyGraph,
  completedShards: Set<string>,
  inProgressShards: Set<string>
): string[] {
  const ready: string[] = [];

  for (const [shardId, node] of graph.nodes) {
    // Skip if already completed or in progress
    if (completedShards.has(shardId) || inProgressShards.has(shardId)) {
      continue;
    }

    // Check if all blockers are completed
    let allBlockersComplete = true;
    for (const blockerId of node.blockedBy) {
      if (!completedShards.has(blockerId)) {
        allBlockersComplete = false;
        break;
      }
    }

    if (allBlockersComplete) {
      ready.push(shardId);
    }
  }

  return ready;
}

export function canRunInParallel(
  shardA: string,
  shardB: string,
  graph: DependencyGraph
): boolean {
  const nodeA = graph.nodes.get(shardA);
  const nodeB = graph.nodes.get(shardB);

  if (!nodeA || !nodeB) return false;

  // Check if either blocks the other
  if (nodeA.blockedBy.has(shardB) || nodeB.blockedBy.has(shardA)) {
    return false;
  }

  // Check for file conflicts
  for (const mod of nodeA.modifies) {
    if (nodeB.modifies.has(mod)) {
      return false;
    }
  }

  return true;
}

export function visualizeDependencies(graph: DependencyGraph): string {
  const lines: string[] = ["Dependency Graph:", ""];

  for (const group of graph.parallelGroups) {
    const groupStr = group.join(" | ");
    lines.push(`  [${groupStr}]`);
    lines.push("       ↓");
  }

  // Remove last arrow
  lines.pop();

  lines.push("");
  lines.push("Execution Order:");
  lines.push(`  ${graph.executionOrder.join(" → ")}`);

  return lines.join("\n");
}
