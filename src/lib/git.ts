import { spawn } from "child_process";
import { join } from "path";
import { mkdir, rm } from "fs/promises";

// Debug output callback - set this to enable debug logging
let debugCallback: ((msg: string) => void) | null = null;

export function setGitDebugCallback(cb: ((msg: string) => void) | null) {
  debugCallback = cb;
}

async function runGit(
  args: string[],
  cwd?: string
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const cmdStr = `git ${args.join(" ")}`;
    debugCallback?.(`[git] $ ${cmdStr}${cwd ? ` (in ${cwd})` : ""}\n`);
    
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
      const result = { stdout: stdout.trim(), stderr: stderr.trim(), code: code || 0 };
      if (result.code !== 0) {
        debugCallback?.(`[git] exit ${result.code}: ${result.stderr || result.stdout}\n`);
      } else if (result.stdout) {
        debugCallback?.(`[git] ok: ${result.stdout.slice(0, 100)}${result.stdout.length > 100 ? "..." : ""}\n`);
      } else {
        debugCallback?.(`[git] ok\n`);
      }
      resolve(result);
    });

    proc.on("error", (err) => {
      debugCallback?.(`[git] error: ${err.message}\n`);
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
): Promise<{ success: boolean; error?: string }> {
  const parentDir = join(path, "..");
  try {
    await mkdir(parentDir, { recursive: true });
  } catch {
    // Ignore if exists
  }

  // Clean up any existing worktree directory (ephemeral), but keep the branch (has commits)
  await runGit(["worktree", "remove", "--force", path], cwd);
  await rm(path, { recursive: true, force: true }).catch(() => {});
  await runGit(["worktree", "prune"], cwd);
  
  // Check if branch already exists
  const branchExists = await runGit(["rev-parse", "--verify", branch], cwd);
  
  // Use existing branch or create new one
  const result = branchExists.code === 0
    ? await runGit(["worktree", "add", path, branch], cwd)
    : await runGit(["worktree", "add", "-b", branch, path], cwd);
  
  if (result.code !== 0) {
    return { success: false, error: result.stderr || "Failed to create worktree" };
  }
  return { success: true };
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

// Review merge operations - merge shard branches sequentially

export async function cherryPickBranch(
  branch: string,
  cwd?: string
): Promise<{ success: boolean; error?: string }> {
  // Get the commits that are unique to this branch (not in current HEAD)
  const currentHead = await runGit(["rev-parse", "HEAD"], cwd);
  const branchHead = await runGit(["rev-parse", branch], cwd);
  
  if (currentHead.stdout === branchHead.stdout) {
    // Branch has no new commits
    return { success: true };
  }
  
  // Find merge base and cherry-pick commits
  const mergeBase = await runGit(["merge-base", "HEAD", branch], cwd);
  if (mergeBase.code !== 0) {
    return { success: false, error: "Could not find merge base" };
  }
  
  // Get list of commits to cherry-pick
  const commits = await runGit(
    ["rev-list", "--reverse", `${mergeBase.stdout}..${branch}`],
    cwd
  );
  
  if (!commits.stdout.trim()) {
    return { success: true }; // No commits to cherry-pick
  }
  
  // Cherry-pick each commit
  for (const commit of commits.stdout.trim().split("\n")) {
    const result = await runGit(["cherry-pick", commit], cwd);
    if (result.code !== 0) {
      // Abort and return error
      await runGit(["cherry-pick", "--abort"], cwd);
      return { success: false, error: `Cherry-pick failed: ${result.stderr}` };
    }
  }
  
  return { success: true };
}

export async function mergeBranch(
  branch: string,
  noFf = true,
  cwd?: string
): Promise<{ success: boolean; error?: string }> {
  const args = ["merge", branch];
  if (noFf) {
    args.push("--no-ff");
  }
  args.push("-m", `Merge ${branch}`);
  
  const result = await runGit(args, cwd);
  if (result.code !== 0) {
    // Check for conflicts
    if (result.stderr.includes("CONFLICT") || result.stderr.includes("conflict")) {
      await runGit(["merge", "--abort"], cwd);
      return { success: false, error: `Merge conflict: ${result.stderr}` };
    }
    return { success: false, error: result.stderr || "Merge failed" };
  }
  
  return { success: true };
}

export async function createReviewWorktree(
  sprintBranch: string,
  reviewPath: string,
  cwd?: string
): Promise<{ success: boolean; error?: string }> {
  const reviewBranch = `${sprintBranch}-review`;
  
  // Clean up any existing review worktree
  await runGit(["worktree", "remove", "--force", reviewPath], cwd);
  await rm(reviewPath, { recursive: true, force: true }).catch(() => {});
  await runGit(["worktree", "prune"], cwd);
  
  // Delete review branch if exists
  await runGit(["branch", "-D", reviewBranch], cwd);
  
  // Create new review branch from sprint branch
  const result = await runGit(
    ["worktree", "add", "-b", reviewBranch, reviewPath, sprintBranch],
    cwd
  );
  
  if (result.code !== 0) {
    return { success: false, error: result.stderr || "Failed to create review worktree" };
  }
  
  return { success: true };
}

export async function getCommitsBetween(
  baseBranch: string,
  targetBranch: string,
  cwd?: string
): Promise<string[]> {
  const result = await runGit(
    ["log", "--oneline", `${baseBranch}..${targetBranch}`],
    cwd
  );
  
  if (result.code !== 0 || !result.stdout.trim()) {
    return [];
  }
  
  return result.stdout.trim().split("\n");
}
