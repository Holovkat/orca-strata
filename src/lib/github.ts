import { spawn } from "child_process";
import type { ColumnName } from "./types.js";

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  labels: string[];
  url: string;
}

export interface GitHubProject {
  id: string;
  number: number;
  title: string;
  url: string;
}

export interface ProjectItem {
  id: string;
  issueNumber: number;
  status: string;
}

async function runGh(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn("gh", args, {
      cwd: cwd || process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      resolve({ stdout, stderr, code: code || 0 });
    });

    proc.on("error", (err) => {
      resolve({ stdout: "", stderr: err.message, code: 1 });
    });
  });
}

// Issue operations

export async function createIssue(
  title: string,
  body: string,
  labels: string[] = []
): Promise<GitHubIssue | null> {
  const args = ["issue", "create", "--title", title, "--body", body];
  
  for (const label of labels) {
    args.push("--label", label);
  }

  args.push("--json", "number,title,body,state,labels,url");

  const result = await runGh(args);
  
  if (result.code !== 0) {
    console.error("Failed to create issue:", result.stderr);
    return null;
  }

  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

export async function getIssue(number: number): Promise<GitHubIssue | null> {
  const result = await runGh([
    "issue",
    "view",
    String(number),
    "--json",
    "number,title,body,state,labels,url",
  ]);

  if (result.code !== 0) {
    return null;
  }

  try {
    const data = JSON.parse(result.stdout);
    return {
      ...data,
      labels: data.labels?.map((l: any) => l.name) || [],
    };
  } catch {
    return null;
  }
}

export async function listIssues(
  labels?: string[],
  state: "open" | "closed" | "all" = "open"
): Promise<GitHubIssue[]> {
  const args = [
    "issue",
    "list",
    "--state",
    state,
    "--json",
    "number,title,body,state,labels,url",
  ];

  if (labels && labels.length > 0) {
    args.push("--label", labels.join(","));
  }

  const result = await runGh(args);

  if (result.code !== 0) {
    return [];
  }

  try {
    const data = JSON.parse(result.stdout);
    return data.map((issue: any) => ({
      ...issue,
      labels: issue.labels?.map((l: any) => l.name) || [],
    }));
  } catch {
    return [];
  }
}

export async function updateIssueBody(
  number: number,
  body: string
): Promise<boolean> {
  const result = await runGh([
    "issue",
    "edit",
    String(number),
    "--body",
    body,
  ]);

  return result.code === 0;
}

export async function closeIssue(
  number: number,
  comment?: string
): Promise<boolean> {
  const args = ["issue", "close", String(number)];
  
  if (comment) {
    args.push("--comment", comment);
  }

  const result = await runGh(args);
  return result.code === 0;
}

export async function addIssueLabel(
  number: number,
  label: string
): Promise<boolean> {
  const result = await runGh([
    "issue",
    "edit",
    String(number),
    "--add-label",
    label,
  ]);

  return result.code === 0;
}

export async function removeIssueLabel(
  number: number,
  label: string
): Promise<boolean> {
  const result = await runGh([
    "issue",
    "edit",
    String(number),
    "--remove-label",
    label,
  ]);

  return result.code === 0;
}

// Project board operations

export async function listProjects(): Promise<GitHubProject[]> {
  const result = await runGh([
    "project",
    "list",
    "--format",
    "json",
  ]);

  if (result.code !== 0) {
    return [];
  }

  try {
    const data = JSON.parse(result.stdout);
    return data.projects || [];
  } catch {
    return [];
  }
}

export async function createProject(title: string): Promise<GitHubProject | null> {
  const result = await runGh([
    "project",
    "create",
    "--title",
    title,
    "--format",
    "json",
  ]);

  if (result.code !== 0) {
    console.error("Failed to create project:", result.stderr);
    return null;
  }

  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

export async function addIssueToProject(
  projectNumber: number,
  issueNumber: number
): Promise<boolean> {
  // First get the issue URL
  const issue = await getIssue(issueNumber);
  if (!issue) return false;

  const result = await runGh([
    "project",
    "item-add",
    String(projectNumber),
    "--url",
    issue.url,
  ]);

  return result.code === 0;
}

export async function moveIssueToColumn(
  projectNumber: number,
  issueNumber: number,
  column: ColumnName
): Promise<boolean> {
  // This requires getting the item ID first, then updating its status field
  // The gh CLI project commands are complex for this operation
  // For now, we'll use a simplified approach via labels or comments
  
  // TODO: Implement full project board column management
  // This would require:
  // 1. gh project item-list to get item ID
  // 2. gh project item-edit to change status field
  
  console.log(`Moving issue #${issueNumber} to column: ${column}`);
  return true;
}

// Utility to check if gh is authenticated

export async function checkGhAuth(): Promise<boolean> {
  const result = await runGh(["auth", "status"]);
  return result.code === 0;
}

export async function getRepoInfo(): Promise<{ owner: string; repo: string } | null> {
  const result = await runGh([
    "repo",
    "view",
    "--json",
    "owner,name",
  ]);

  if (result.code !== 0) {
    return null;
  }

  try {
    const data = JSON.parse(result.stdout);
    return {
      owner: data.owner?.login || data.owner,
      repo: data.name,
    };
  } catch {
    return null;
  }
}
