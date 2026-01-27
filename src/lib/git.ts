import { spawn } from "child_process";
import { join } from "path";
import { mkdir, rm } from "fs/promises";

async function runGit(
  args: string[],
  cwd?: string
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn("git", args, {
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
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: code || 0 });
    });

    proc.on("error", (err) => {
      resolve({ stdout: "", stderr: err.message, code: 1 });
    });
  });
}

// Branch operations

export async function getCurrentBranch(cwd?: string): Promise<string | null> {
  const result = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  return result.code === 0 ? result.stdout : null;
}

export async function branchExists(branch: string, cwd?: string): Promise<boolean> {
  const result = await runGit(["rev-parse", "--verify", branch], cwd);
  return result.code === 0;
}

export async function createBranch(
  name: string,
  fromBranch?: string,
  cwd?: string
): Promise<boolean> {
  // Graphite stacking: branch from current HEAD (previous branch), not main
  const args = fromBranch
    ? ["checkout", "-b", name, fromBranch]
    : ["checkout", "-b", name];

  const result = await runGit(args, cwd);
  return result.code === 0;
}

export async function createStackedBranch(
  name: string,
  cwd?: string
): Promise<boolean> {
  // Always branch from current HEAD (Graphite stacking)
  const result = await runGit(["checkout", "-b", name], cwd);
  return result.code === 0;
}

export async function checkoutBranch(branch: string, cwd?: string): Promise<boolean> {
  const result = await runGit(["checkout", branch], cwd);
  return result.code === 0;
}

export async function deleteBranch(
  branch: string,
  force = false,
  cwd?: string
): Promise<boolean> {
  const args = force ? ["branch", "-D", branch] : ["branch", "-d", branch];
  const result = await runGit(args, cwd);
  return result.code === 0;
}

export async function listBranches(cwd?: string): Promise<string[]> {
  const result = await runGit(["branch", "--list", "--format=%(refname:short)"], cwd);
  if (result.code !== 0) return [];
  return result.stdout.split("\n").filter(Boolean);
}

// Worktree operations

export async function createWorktree(
  path: string,
  branch: string,
  cwd?: string
): Promise<boolean> {
  // Ensure the worktree directory parent exists
  const parentDir = join(path, "..");
  try {
    await mkdir(parentDir, { recursive: true });
  } catch {
    // Ignore if exists
  }

  const result = await runGit(["worktree", "add", path, branch], cwd);
  return result.code === 0;
}

export async function createWorktreeWithNewBranch(
  path: string,
  branch: string,
  cwd?: string
): Promise<boolean> {
  const parentDir = join(path, "..");
  try {
    await mkdir(parentDir, { recursive: true });
  } catch {
    // Ignore if exists
  }

  const result = await runGit(["worktree", "add", "-b", branch, path], cwd);
  return result.code === 0;
}

export async function removeWorktree(
  path: string,
  force = false,
  cwd?: string
): Promise<boolean> {
  const args = force
    ? ["worktree", "remove", "--force", path]
    : ["worktree", "remove", path];

  const result = await runGit(args, cwd);
  
  // Also try to clean up the directory if it still exists
  try {
    await rm(path, { recursive: true, force: true });
  } catch {
    // Ignore errors
  }

  return result.code === 0;
}

export async function listWorktrees(
  cwd?: string
): Promise<Array<{ path: string; branch: string; head: string }>> {
  const result = await runGit(["worktree", "list", "--porcelain"], cwd);
  if (result.code !== 0) return [];

  const worktrees: Array<{ path: string; branch: string; head: string }> = [];
  let current: { path: string; branch: string; head: string } = {
    path: "",
    branch: "",
    head: "",
  };

  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current.path) {
        worktrees.push(current);
      }
      current = { path: line.slice(9), branch: "", head: "" };
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice(5);
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice(7).replace("refs/heads/", "");
    }
  }

  if (current.path) {
    worktrees.push(current);
  }

  return worktrees;
}

export async function pruneWorktrees(cwd?: string): Promise<boolean> {
  const result = await runGit(["worktree", "prune"], cwd);
  return result.code === 0;
}

// Rebase and merge operations

export async function rebase(
  onto: string,
  cwd?: string
): Promise<{ success: boolean; conflicts: boolean }> {
  const result = await runGit(["rebase", onto], cwd);
  
  if (result.code === 0) {
    return { success: true, conflicts: false };
  }

  // Check if there are conflicts
  const statusResult = await runGit(["status", "--porcelain"], cwd);
  const hasConflicts = statusResult.stdout.includes("UU ");

  return { success: false, conflicts: hasConflicts };
}

export async function abortRebase(cwd?: string): Promise<boolean> {
  const result = await runGit(["rebase", "--abort"], cwd);
  return result.code === 0;
}

export async function push(
  remote = "origin",
  branch?: string,
  forceWithLease = false,
  cwd?: string
): Promise<boolean> {
  const args = ["push", remote];
  
  if (branch) {
    args.push(branch);
  }

  if (forceWithLease) {
    args.push("--force-with-lease");
  }

  const result = await runGit(args, cwd);
  return result.code === 0;
}

export async function fetch(remote = "origin", cwd?: string): Promise<boolean> {
  const result = await runGit(["fetch", remote], cwd);
  return result.code === 0;
}

// Status and diff

export async function hasUncommittedChanges(cwd?: string): Promise<boolean> {
  const result = await runGit(["status", "--porcelain"], cwd);
  return result.stdout.trim().length > 0;
}

export async function getStatus(
  cwd?: string
): Promise<Array<{ status: string; file: string }>> {
  const result = await runGit(["status", "--porcelain"], cwd);
  if (result.code !== 0 || !result.stdout) return [];

  return result.stdout.split("\n").filter(Boolean).map((line) => ({
    status: line.slice(0, 2).trim(),
    file: line.slice(3),
  }));
}

// Commit operations

export async function commit(
  message: string,
  cwd?: string
): Promise<boolean> {
  const result = await runGit(["commit", "-m", message], cwd);
  return result.code === 0;
}

export async function addAll(cwd?: string): Promise<boolean> {
  const result = await runGit(["add", "-A"], cwd);
  return result.code === 0;
}

// Stack operations for Graphite-style workflow

export async function getStackedBranches(
  baseBranch = "main",
  cwd?: string
): Promise<string[]> {
  // Get branches that are ahead of base branch
  const branches = await listBranches(cwd);
  const stack: string[] = [];

  for (const branch of branches) {
    if (branch === baseBranch) continue;

    // Check if this branch is ahead of main
    const result = await runGit(
      ["rev-list", "--count", `${baseBranch}..${branch}`],
      cwd
    );

    if (result.code === 0 && parseInt(result.stdout) > 0) {
      stack.push(branch);
    }
  }

  return stack;
}

export async function rebaseStack(
  baseBranch = "main",
  cwd?: string
): Promise<{ success: boolean; failedBranch?: string }> {
  const stack = await getStackedBranches(baseBranch, cwd);
  const currentBranch = await getCurrentBranch(cwd);

  // Fetch latest from origin
  await fetch("origin", cwd);

  for (const branch of stack) {
    await checkoutBranch(branch, cwd);
    const result = await rebase(`origin/${baseBranch}`, cwd);

    if (!result.success) {
      await abortRebase(cwd);
      // Restore original branch
      if (currentBranch) {
        await checkoutBranch(currentBranch, cwd);
      }
      return { success: false, failedBranch: branch };
    }
  }

  // Restore original branch
  if (currentBranch) {
    await checkoutBranch(currentBranch, cwd);
  }

  return { success: true };
}
