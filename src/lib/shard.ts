import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname, relative, isAbsolute } from "path";
import { homedir } from "os";
import type { Shard, ColumnName } from "./types.js";

// Convert a path to a proper markdown-compatible link path
// Expands ~ to home directory and makes paths relative or uses file:// protocol
function toMarkdownLinkPath(path: string, fromDir: string): string {
  let resolvedPath = path;
  
  // Expand ~ to home directory
  if (resolvedPath.startsWith("~/")) {
    resolvedPath = join(homedir(), resolvedPath.slice(2));
  }
  
  // Handle @file: and @folder: prefixes
  if (resolvedPath.startsWith("@file:") || resolvedPath.startsWith("@folder:")) {
    resolvedPath = resolvedPath.replace(/^@(file|folder):/, "");
    // Expand ~ again if present after prefix
    if (resolvedPath.startsWith("~/")) {
      resolvedPath = join(homedir(), resolvedPath.slice(2));
    }
  }
  
  // If it's an absolute path, try to make it relative to fromDir
  if (isAbsolute(resolvedPath)) {
    const relativePath = relative(fromDir, resolvedPath);
    // If relative path doesn't go too far up, use it
    if (!relativePath.startsWith("../../../")) {
      return relativePath;
    }
    // Otherwise use file:// URL for absolute path
    return `file://${resolvedPath}`;
  }
  
  return resolvedPath;
}

export interface ShardMetadata {
  title: string;
  type: "backend" | "frontend" | "fullstack" | "docs";
  dependencies: string[];
  creates: string[];
  modifies: string[];
  linkedDocs: string[];
  issueNumber?: number;
  status: ColumnName;
  model?: string;
}

export interface ParsedShard {
  metadata: ShardMetadata;
  requiredReading: string[];
  context: string;
  task: string;
  newInShard: string[];
  acceptanceCriteria: string[];
  rawContent: string;
}

const SHARD_TEMPLATE = `# {{TITLE}}

## Required Reading
> **IMPORTANT:** Read this entire shard and ALL linked documents before starting.

{{REQUIRED_READING}}

## Context
{{CONTEXT}}

## Task
{{TASK}}

## New in This Shard
{{NEW_IN_SHARD}}

## Acceptance Criteria
{{ACCEPTANCE_CRITERIA}}

## Dependencies
<!-- Auto-populated by orchestrator -->
- Creates: {{CREATES}}
- Depends on: {{DEPENDS_ON}}
- Modifies: {{MODIFIES}}

## Linked Issue
GitHub: #{{ISSUE_NUMBER}}
`;

export async function readShard(filePath: string): Promise<ParsedShard | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    return parseShard(content);
  } catch {
    return null;
  }
}

export function parseShard(content: string): ParsedShard {
  const lines = content.split("\n");
  
  let title = "";
  const requiredReading: string[] = [];
  let context = "";
  let task = "";
  const newInShard: string[] = [];
  const acceptanceCriteria: string[] = [];
  const dependencies: string[] = [];
  const creates: string[] = [];
  const modifies: string[] = [];
  let issueNumber: number | undefined;
  let status: ColumnName = "Ready to Build";
  let model: string | undefined;
  
  let currentSection = "";
  
  for (const line of lines) {
    // Detect section headers
    if (line.startsWith("# ")) {
      title = line.slice(2).trim();
      continue;
    }
    
    if (line.startsWith("## ")) {
      currentSection = line.slice(3).trim().toLowerCase();
      continue;
    }
    
    // Parse section content
    switch (currentSection) {
      case "required reading":
        if (line.startsWith("- [")) {
          const match = line.match(/\[([^\]]+)\]\(([^)]+)\)/);
          if (match && match[2]) {
            requiredReading.push(match[2]);
          }
        }
        break;
        
      case "context":
        if (line.trim()) {
          context += (context ? "\n" : "") + line;
        }
        break;
        
      case "task":
        if (line.trim()) {
          task += (task ? "\n" : "") + line;
        }
        break;
        
      case "new in this shard":
        if (line.startsWith("- ")) {
          newInShard.push(line.slice(2));
        }
        break;
        
      case "acceptance criteria":
        if (line.startsWith("- [ ]") || line.startsWith("- [x]")) {
          acceptanceCriteria.push(line.slice(6).trim());
        }
        break;
        
      case "dependencies":
        if (line.startsWith("- Creates:")) {
          creates.push(...parseList(line.slice(10)));
        } else if (line.startsWith("- Depends on:")) {
          dependencies.push(...parseList(line.slice(13)));
        } else if (line.startsWith("- Modifies:")) {
          modifies.push(...parseList(line.slice(11)));
        }
        break;
        
      case "linked issue":
        const issueMatch = line.match(/#(\d+)/);
        if (issueMatch && issueMatch[1]) {
          issueNumber = parseInt(issueMatch[1]);
        }
        break;
        
      case "model override":
        if (line.trim() && !line.startsWith("<!--")) {
          model = line.trim();
        }
        break;
    }
  }
  
  // Infer type from content
  const type = inferShardType(content, creates, modifies);
  
  return {
    metadata: {
      title,
      type,
      dependencies,
      creates,
      modifies,
      linkedDocs: requiredReading,
      issueNumber,
      status,
      model,
    },
    requiredReading,
    context: context.trim(),
    task: task.trim(),
    newInShard,
    acceptanceCriteria,
    rawContent: content,
  };
}

function parseList(str: string): string[] {
  return str
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function inferShardType(
  content: string,
  creates: string[],
  modifies: string[]
): "backend" | "frontend" | "fullstack" | "docs" {
  const allFiles = [...creates, ...modifies].join(" ").toLowerCase();
  const contentLower = content.toLowerCase();
  
  const hasBackend =
    allFiles.includes("api") ||
    allFiles.includes("server") ||
    allFiles.includes("convex") ||
    allFiles.includes("schema") ||
    contentLower.includes("mutation") ||
    contentLower.includes("query") ||
    contentLower.includes("database");
    
  const hasFrontend =
    allFiles.includes("component") ||
    allFiles.includes(".tsx") ||
    allFiles.includes("src/app") ||
    allFiles.includes("src/components") ||
    contentLower.includes("react") ||
    contentLower.includes("ui");
    
  const hasDocs =
    allFiles.includes("docs/") ||
    allFiles.includes(".md") ||
    contentLower.includes("documentation");
  
  if (hasDocs && !hasBackend && !hasFrontend) {
    return "docs";
  }
  
  if (hasBackend && hasFrontend) {
    return "fullstack";
  }
  
  if (hasBackend) {
    return "backend";
  }
  
  if (hasFrontend) {
    return "frontend";
  }
  
  return "fullstack";
}

export async function createShard(
  basePath: string,
  sprintName: string,
  shardId: string,
  data: {
    title: string;
    context: string;
    task: string;
    requiredReading: Array<{ label: string; path: string }>;
    newInShard: string[];
    acceptanceCriteria: string[];
    creates: string[];
    dependsOn: string[];
    modifies: string[];
    issueNumber?: number;
  }
): Promise<string> {
  const dirPath = join(basePath, sprintName);
  const filePath = join(dirPath, `${shardId}.md`);
  
  // Ensure directory exists
  await mkdir(dirPath, { recursive: true });
  
  // Convert paths in requiredReading to proper markdown-compatible links
  const requiredReadingStr = data.requiredReading
    .map((r) => {
      const linkPath = toMarkdownLinkPath(r.path, dirPath);
      return `- [${r.label}](${linkPath})`;
    })
    .join("\n");
    
  const newInShardStr = data.newInShard.map((n) => `- ${n}`).join("\n");
  
  const acceptanceCriteriaStr = data.acceptanceCriteria
    .map((a) => `- [ ] ${a}`)
    .join("\n");
  
  const content = SHARD_TEMPLATE
    .replace("{{TITLE}}", data.title)
    .replace("{{REQUIRED_READING}}", requiredReadingStr || "- None")
    .replace("{{CONTEXT}}", data.context)
    .replace("{{TASK}}", data.task)
    .replace("{{NEW_IN_SHARD}}", newInShardStr || "- N/A")
    .replace("{{ACCEPTANCE_CRITERIA}}", acceptanceCriteriaStr)
    .replace("{{CREATES}}", data.creates.join(", ") || "N/A")
    .replace("{{DEPENDS_ON}}", data.dependsOn.join(", ") || "None")
    .replace("{{MODIFIES}}", data.modifies.join(", ") || "None")
    .replace("{{ISSUE_NUMBER}}", data.issueNumber?.toString() || "TBD");
  
  await writeFile(filePath, content, "utf-8");
  
  return filePath;
}

export async function updateShard(
  filePath: string,
  shard: ParsedShard
): Promise<void> {
  // Rebuild the markdown content from the parsed shard
  const requiredReadingStr = shard.requiredReading
    .map((r) => `- ${r}`)
    .join("\n");

  const newInShardStr = shard.newInShard.map((n) => `- ${n}`).join("\n");

  const acceptanceCriteriaStr = shard.acceptanceCriteria
    .map((a) => `- [ ] ${a}`)
    .join("\n");

  // Model override section (only include if model is set)
  const modelSection = shard.metadata.model 
    ? `\n## Model Override\n${shard.metadata.model}\n`
    : "";

  const content = `# ${shard.metadata.title}

## Required Reading
> **IMPORTANT:** Read this entire shard and ALL linked documents before starting.

${requiredReadingStr || "- None"}

## Context
${shard.context}

## Task
${shard.task}

## New in This Shard
${newInShardStr || "- N/A"}

## Acceptance Criteria
${acceptanceCriteriaStr}

## Dependencies
<!-- Auto-populated by orchestrator -->
- Creates: ${shard.metadata.creates.join(", ") || "N/A"}
- Depends on: ${shard.metadata.dependencies.join(", ") || "None"}
- Modifies: ${shard.metadata.modifies.join(", ") || "None"}

## Linked Issue
GitHub: #${shard.metadata.issueNumber || "TBD"}
${modelSection}`;

  await writeFile(filePath, content, "utf-8");
}

/**
 * Update just the model override in a shard file without rewriting everything
 */
export async function updateShardModel(
  filePath: string,
  model: string | undefined
): Promise<void> {
  const content = await readFile(filePath, "utf-8");
  
  // Remove existing model override section if present
  let newContent = content.replace(/\n## Model Override\n[^\n]+\n?/g, "");
  
  // Add model override section at the end if model is set
  if (model) {
    // Ensure there's a newline at the end before adding
    if (!newContent.endsWith("\n")) {
      newContent += "\n";
    }
    newContent += `\n## Model Override\n${model}\n`;
  }
  
  await writeFile(filePath, newContent, "utf-8");
}

export function shardToIssueBody(shard: ParsedShard): string {
  const requiredReadingList = shard.requiredReading
    .map((r) => `- ${r}`)
    .join("\n");
    
  const acceptanceCriteriaList = shard.acceptanceCriteria
    .map((a) => `- [ ] ${a}`)
    .join("\n");
    
  const newInShardList = shard.newInShard.map((n) => `- ${n}`).join("\n");
  
  return `## Required Reading

> **IMPORTANT:** Read this entire issue and ALL linked documents before starting.

${requiredReadingList || "- See shard file"}

## Context

${shard.context}

## Task

${shard.task}

## New in This Shard

${newInShardList || "- See shard file"}

## Acceptance Criteria

${acceptanceCriteriaList}

## Dependencies

- **Creates:** ${shard.metadata.creates.join(", ") || "N/A"}
- **Depends on:** ${shard.metadata.dependencies.join(", ") || "None"}
- **Modifies:** ${shard.metadata.modifies.join(", ") || "None"}

## Shard File

\`${shard.metadata.title}\`
`;
}

/**
 * Mark a shard as deprecated by prepending deprecation notice
 */
export async function deprecateShard(
  filePath: string,
  reason: string,
  analysis: string
): Promise<void> {
  const content = await readFile(filePath, "utf-8");
  
  const deprecationNotice = `> **⚠️ DEPRECATED**
> 
> **Reason:** ${reason}
> 
> **Date:** ${new Date().toISOString().split("T")[0]}
> 
> **Impact Analysis:**
> ${analysis.split("\n").map(line => `> ${line}`).join("\n")}

---

`;

  const updatedContent = deprecationNotice + content;
  await writeFile(filePath, updatedContent, "utf-8");
  
  // Rename file to indicate deprecated status
  const { dirname: getDirname, basename: getBasename } = await import("path");
  const dir = getDirname(filePath);
  const base = getBasename(filePath);
  const newPath = join(dir, `DEPRECATED-${base}`);
  
  const { rename } = await import("fs/promises");
  await rename(filePath, newPath);
}
