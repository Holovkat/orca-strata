import React, { useState, useCallback, useEffect } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { Menu, type MenuItem } from "../components/Menu.js";
import { Spinner } from "../components/Spinner.js";
import { StatusMessage } from "../components/StatusMessage.js";
import { Markdown } from "../components/Markdown.js";
import { invokeDroid, assignDroidByShardType } from "../lib/droid.js";
import {
  createWorktreeWithNewBranch,
  removeWorktree,
  push,
  rebaseStack,
  getCurrentBranch,
  setGitDebugCallback,
  hasShardWork,
} from "../lib/git.js";
import { closeIssue, updateIssueBody, addIssueLabel, removeIssueLabel } from "../lib/github.js";
import { buildDependencyGraph, getShardsReadyToRun } from "../lib/dependencies.js";
import { readShard } from "../lib/shard.js";
import type { OrcaConfig, SprintStatus, Phase, Shard, ActiveDroid, ColumnName, RunningDroid } from "../lib/types.js";
import { join } from "path";

interface ContinueSprintProps {
  config: OrcaConfig;
  projectPath: string;
  sprintStatus: SprintStatus | null;
  onBack: () => void;
  onStatusChange: (status: SprintStatus) => void;
  onStartChat?: (shard: Shard, prompt?: string, worktreePath?: string) => void;
  // Running droids management (for background execution)
  runningDroids?: RunningDroid[];
  onAddRunningDroid?: (droid: RunningDroid) => void;
  onAppendDroidOutput?: (shardId: string, chunk: string) => void;
  onUpdateDroidStatus?: (shardId: string, status: "running" | "complete" | "failed", exitCode?: number) => void;
  onViewDroid?: (shardId: string) => void;
}

type SubScreen = "menu" | "build" | "review" | "uat" | "user-acceptance" | "deploy";

export function ContinueSprint({
  config,
  projectPath,
  sprintStatus,
  onBack,
  onStatusChange,
  onStartChat,
  runningDroids,
  onAddRunningDroid,
  onAppendDroidOutput,
  onUpdateDroidStatus,
  onViewDroid,
}: ContinueSprintProps) {
  const [subScreen, setSubScreen] = useState<SubScreen>("menu");
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const [droidOutput, setDroidOutput] = useState("");
  // Track which droid we're currently viewing output for (when not minimized)
  const [viewingShardId, setViewingShardId] = useState<string | null>(null);

  const appendDroidOutput = useCallback((chunk: string) => {
    setDroidOutput((prev) => prev + chunk);
  }, []);

  // Allow Esc to minimize when viewing droid output
  useInput((input, key) => {
    if (key.escape) {
      if (viewingShardId) {
        // Minimize - go back to menu while droid runs in background
        setViewingShardId(null);
        setLoading(false);
        setDroidOutput("");
        setMessage({ type: "info", text: "Droid running in background. View in 'View Active Droids'" });
      } else if (!loading) {
        if (subScreen === "menu") {
          onBack();
        } else {
          setSubScreen("menu");
          setMessage(null);
        }
      }
    }
  });

  if (!sprintStatus) {
    return (
      <Box>
        <StatusMessage type="warning" message="No active sprint. Start a new sprint first." />
      </Box>
    );
  }

  const getPhaseFromCounts = (): Phase => {
    const { counts } = sprintStatus;
    if (counts.done === counts.total) return "deploy";
    if (counts.userAcceptance > 0) return "user-acceptance";
    if (counts.uatInProgress > 0 || counts.readyForUat > 0) return "uat";
    if (counts.inReview > 0 || counts.readyForReview > 0) return "review";
    return "build";
  };

  const currentPhase = getPhaseFromCounts();

  const updateShardStatus = (shardId: string, newStatus: ColumnName) => {
    const updatedShards = sprintStatus.sprint.shards.map((s) =>
      s.id === shardId ? { ...s, status: newStatus } : s
    );

    const counts = calculateCounts(updatedShards);

    onStatusChange({
      ...sprintStatus,
      sprint: { ...sprintStatus.sprint, shards: updatedShards },
      counts,
    });
  };

  const addActiveDroid = (shardId: string, droidName: string) => {
    const activeDroid: ActiveDroid = {
      shardId,
      droid: droidName,
      status: "running",
      startedAt: new Date(),
    };

    onStatusChange({
      ...sprintStatus,
      activeDroids: [...sprintStatus.activeDroids, activeDroid],
    });
  };

  const removeActiveDroid = (shardId: string, status: "complete" | "failed") => {
    onStatusChange({
      ...sprintStatus,
      activeDroids: sprintStatus.activeDroids.filter((d) => d.shardId !== shardId),
    });
  };

  const menuItems: MenuItem[] = [
    {
      label: "Run Next Step",
      value: "auto",
      hint: `Auto-detect: ${currentPhase}`,
    },
    {
      label: "Build Phase",
      value: "build",
      hint: `${sprintStatus.counts.readyToBuild} ready, ${sprintStatus.counts.inProgress} in progress`,
    },
    {
      label: "Review Phase",
      value: "review",
      hint: `${sprintStatus.counts.readyForReview} ready for review`,
    },
    {
      label: "UAT Phase",
      value: "uat",
      hint: `${sprintStatus.counts.readyForUat} ready for UAT`,
    },
    {
      label: "User Acceptance",
      value: "user-acceptance",
      hint: `${sprintStatus.counts.userAcceptance} awaiting user`,
    },
    {
      label: "Deploy",
      value: "deploy",
      disabled: sprintStatus.counts.done !== sprintStatus.counts.total,
      hint:
        sprintStatus.counts.done === sprintStatus.counts.total
          ? "All items complete"
          : `${sprintStatus.counts.done}/${sprintStatus.counts.total} complete`,
    },
    {
      label: "Back",
      value: "back",
    },
  ];

  const handleSelect = async (value: string) => {
    if (value === "back") {
      onBack();
      return;
    }

    if (value === "auto") {
      setSubScreen(currentPhase as SubScreen);
      return;
    }

    setSubScreen(value as SubScreen);
  };

  const renderSubScreen = () => {
    switch (subScreen) {
      case "build":
        return (
          <BuildPhase
            config={config}
            projectPath={projectPath}
            sprintStatus={sprintStatus}
            onStatusChange={onStatusChange}
            onBack={() => setSubScreen("menu")}
            setLoading={setLoading}
            setLoadingMessage={setLoadingMessage}
            setMessage={setMessage}
            appendDroidOutput={appendDroidOutput}
            onStartChat={onStartChat}
            runningDroids={runningDroids}
            onAddRunningDroid={onAddRunningDroid}
            onAppendDroidOutput={onAppendDroidOutput}
            onUpdateDroidStatus={onUpdateDroidStatus}
            onViewDroid={onViewDroid}
            setViewingShardId={setViewingShardId}
          />
        );
      case "review":
        return (
          <ReviewPhase
            config={config}
            projectPath={projectPath}
            sprintStatus={sprintStatus}
            onStatusChange={onStatusChange}
            onBack={() => setSubScreen("menu")}
            setLoading={setLoading}
            setLoadingMessage={setLoadingMessage}
            setMessage={setMessage}
            appendDroidOutput={appendDroidOutput}
          />
        );
      case "uat":
        return (
          <UatPhase
            config={config}
            projectPath={projectPath}
            sprintStatus={sprintStatus}
            onStatusChange={onStatusChange}
            onBack={() => setSubScreen("menu")}
            setLoading={setLoading}
            setLoadingMessage={setLoadingMessage}
            setMessage={setMessage}
            appendDroidOutput={appendDroidOutput}
          />
        );
      case "user-acceptance":
        return (
          <UserAcceptancePhase
            sprintStatus={sprintStatus}
            onStatusChange={onStatusChange}
            onBack={() => setSubScreen("menu")}
          />
        );
      case "deploy":
        return (
          <DeployPhase
            config={config}
            projectPath={projectPath}
            sprintStatus={sprintStatus}
            onBack={() => setSubScreen("menu")}
            setLoading={setLoading}
            setLoadingMessage={setLoadingMessage}
            setMessage={setMessage}
          />
        );
      default:
        return <Menu items={menuItems} onSelect={handleSelect} title="Continue Sprint" />;
    }
  };

  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || 24;

  return (
    <Box flexDirection="column" height={terminalHeight - 1}>
      <Box marginBottom={1} flexShrink={0}>
        <Text bold color="white">
          Sprint: {sprintStatus.sprint.name}
        </Text>
        <Text color="gray"> - Phase: {currentPhase}</Text>
      </Box>
      {message && (
        <Box marginBottom={1} flexShrink={0}>
          <StatusMessage type={message.type} message={message.text} />
        </Box>
      )}
      {loading ? (
        <Box flexDirection="column" flexGrow={1} overflow="hidden">
          <Spinner message={loadingMessage} />
          {droidOutput && (
            <Box marginTop={1} flexDirection="column" flexGrow={1} overflow="hidden">
              <Text color="yellow">--- Droid Output ---</Text>
              <Markdown maxLines={Math.max(10, terminalHeight - 10)}>{droidOutput.slice(-2000)}</Markdown>
            </Box>
          )}
        </Box>
      ) : (
        <Box flexGrow={1} overflow="hidden">
          {renderSubScreen()}
        </Box>
      )}
      {!loading && (
        <Box marginTop={1} flexShrink={0}>
          <Text color="gray">Esc to go back</Text>
        </Box>
      )}
    </Box>
  );
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

// Sub-phase components

interface PhaseProps {
  config: OrcaConfig;
  projectPath: string;
  sprintStatus: SprintStatus;
  onStatusChange: (status: SprintStatus) => void;
  onBack: () => void;
  setLoading: (loading: boolean) => void;
  setLoadingMessage: (msg: string) => void;
  setMessage: (msg: { type: "success" | "error" | "info"; text: string } | null) => void;
  appendDroidOutput?: (chunk: string) => void;
  onStartChat?: (shard: Shard, prompt?: string, worktreePath?: string) => void;
}

interface BuildPhaseProps extends PhaseProps {
  runningDroids?: RunningDroid[];
  onAddRunningDroid?: (droid: RunningDroid) => void;
  onAppendDroidOutput?: (shardId: string, chunk: string) => void;
  onUpdateDroidStatus?: (shardId: string, status: "running" | "complete" | "failed", exitCode?: number) => void;
  onViewDroid?: (shardId: string) => void;
  setViewingShardId: (shardId: string | null) => void;
}

function BuildPhase({
  config,
  projectPath,
  sprintStatus,
  onStatusChange,
  onBack,
  setLoading,
  setLoadingMessage,
  setMessage,
  appendDroidOutput,
  onStartChat,
  runningDroids,
  onAddRunningDroid,
  onAppendDroidOutput,
  onUpdateDroidStatus,
  onViewDroid,
  setViewingShardId,
}: BuildPhaseProps) {
  const [runMode, setRunMode] = React.useState<"auto" | "interactive">("auto");
  const [workMode, setWorkMode] = React.useState<"skip" | "rebuild">("skip");
  // Track which shards have existing work (commits on their branch)
  const [shardsWithWork, setShardsWithWork] = React.useState<Map<string, number>>(new Map());
  const [checkingWork, setCheckingWork] = React.useState(true);
  
  // Check for existing work on all shards when component mounts
  useEffect(() => {
    const checkAllShards = async () => {
      setCheckingWork(true);
      const workMap = new Map<string, number>();
      
      for (const shard of sprintStatus.sprint.shards) {
        const branchName = `${sprintStatus.sprint.branch}-${shard.id}`;
        try {
          const existingWork = await hasShardWork(branchName, sprintStatus.sprint.branch, projectPath);
          if (existingWork.hasCommits) {
            workMap.set(shard.id, existingWork.commitCount);
          }
        } catch {
          // Ignore errors
        }
      }
      
      setShardsWithWork(workMap);
      setCheckingWork(false);
    };
    
    checkAllShards();
  }, [sprintStatus.sprint.shards, sprintStatus.sprint.branch, projectPath]);
  
  const graph = buildDependencyGraph(sprintStatus.sprint.shards);
  const completedIds = new Set(
    sprintStatus.sprint.shards.filter((s) => s.status === "Done" || s.status === "Ready for Review").map((s) => s.id)
  );
  const inProgressIds = new Set(
    sprintStatus.sprint.shards.filter((s) => s.status === "In Progress").map((s) => s.id)
  );

  const readyShards = getShardsReadyToRun(graph, completedIds, inProgressIds);
  const readyShardObjects = sprintStatus.sprint.shards.filter((s) => readyShards.includes(s.id));
  
  // Count shards with existing work vs truly ready
  const readyWithWork = readyShardObjects.filter(s => shardsWithWork.has(s.id));
  const readyWithoutWork = readyShardObjects.filter(s => !shardsWithWork.has(s.id));

  // Handle Shift+Tab to toggle modes
  useInput((input, key) => {
    if (key.tab && key.shift) {
      setRunMode(prev => prev === "auto" ? "interactive" : "auto");
    }
    // Alt+S to toggle skip/rebuild mode
    if (input === "s" && key.meta) {
      setWorkMode(prev => prev === "skip" ? "rebuild" : "skip");
    }
  });

  const startShard = async (shard: Shard, forceRebuild = false) => {
    setLoading(true);
    setLoadingMessage(`Checking ${shard.title}...`);

    try {
      const worktreePath = join(projectPath, config.paths.worktrees, shard.id);
      const branchName = `${sprintStatus.sprint.branch}-${shard.id}`;

      // Check for existing work on this shard branch
      const existingWork = await hasShardWork(branchName, sprintStatus.sprint.branch, projectPath);
      
      if (existingWork.hasCommits && !forceRebuild && workMode === "skip") {
        // Skip this shard - it has existing work
        appendDroidOutput?.(`[Skipping ${shard.id}: has ${existingWork.commitCount} commit(s) on branch ${branchName}]\n`);
        setMessage({ 
          type: "info", 
          text: `Skipped ${shard.title} - has ${existingWork.commitCount} existing commit(s). Use Rebuild mode to redo.` 
        });
        setLoading(false);
        return;
      }

      if (existingWork.hasCommits && (forceRebuild || workMode === "rebuild")) {
        appendDroidOutput?.(`[Rebuilding ${shard.id}: overwriting ${existingWork.commitCount} existing commit(s)]\n`);
      }

      setLoadingMessage(`Starting ${shard.title}...`);

      // Determine base branch for stacking: if shard has dependencies, 
      // branch from the last completed dependency (Graphite-style stacking)
      let baseBranch: string | undefined;
      if (shard.dependencies.length > 0) {
        // Find completed dependencies and get the last one's branch
        const completedDeps = shard.dependencies
          .map(depId => sprintStatus.sprint.shards.find(s => s.id === depId))
          .filter(s => s && (s.status === "Done" || s.status === "Ready for Review") && s.branch);
        
        if (completedDeps.length > 0) {
          // Use the last dependency's branch as base
          const lastDep = completedDeps[completedDeps.length - 1];
          baseBranch = lastDep?.branch;
          appendDroidOutput?.(`[Stacking from dependency: ${lastDep?.id} (${baseBranch})]\n`);
        }
      }

      setLoadingMessage(`Creating worktree for ${shard.id}...`);
      
      // Enable git debug output
      setGitDebugCallback((msg) => appendDroidOutput?.(msg));
      
      const worktreeResult = await createWorktreeWithNewBranch(worktreePath, branchName, projectPath, baseBranch);
      
      // Disable git debug after worktree creation
      setGitDebugCallback(null);
      
      if (!worktreeResult.success) {
        appendDroidOutput?.(`[Worktree error: ${worktreeResult.error}]\n`);
      }

      // Update shard status
      const updatedShards = sprintStatus.sprint.shards.map((s) =>
        s.id === shard.id ? { ...s, status: "In Progress" as ColumnName, worktree: worktreePath, branch: branchName } : s
      );

      // Add active droid
      const droidName = assignDroidByShardType(shard.type);
      const activeDroid: ActiveDroid = {
        shardId: shard.id,
        droid: droidName,
        status: "running",
        startedAt: new Date(),
      };

      onStatusChange({
        ...sprintStatus,
        sprint: { ...sprintStatus.sprint, shards: updatedShards },
        counts: calculateCounts(updatedShards),
        activeDroids: [...sprintStatus.activeDroids, activeDroid],
      });

      // Read the shard file for context
      const shardContent = await readShard(join(projectPath, shard.file));

      // Invoke the droid
      setLoadingMessage(`Running ${droidName} on ${shard.title}...`);

      const prompt = `You are working on shard: ${shard.title}

## IMPORTANT: Read First
Read the entire shard file and ALL linked documents before starting:
${shard.file}

## Task
${shardContent?.task || "Implement this shard according to the shard file."}

## Acceptance Criteria
${shardContent?.acceptanceCriteria.map((c) => `- ${c}`).join("\n") || "See shard file"}

## Working Directory
You are working in: ${worktreePath}
This is an isolated worktree. Commit your changes when complete.

## When Done
1. Ensure all acceptance criteria are met
2. Run lint and typecheck
3. Commit your changes with a descriptive message
4. Report completion

Begin implementation.`;

      const result = await invokeDroid(
        {
          droid: droidName,
          prompt,
          autoLevel: "high",
          model: shard.model || config.droids.model, // Use shard-specific model if set, else config default
          cwd: worktreePath,
        },
        (chunk) => appendDroidOutput?.(chunk)
      );

      // Update status based on result
      const newStatus: ColumnName = result.success ? "Ready for Review" : "Ready to Build";

      const finalShards = sprintStatus.sprint.shards.map((s) =>
        s.id === shard.id ? { ...s, status: newStatus } : s
      );

      // Update GitHub issue labels if shard has an issue
      if (shard.issueNumber) {
        try {
          await import("../lib/github.js").then(({ updateIssueLabels }) =>
            updateIssueLabels(shard.issueNumber!, newStatus)
          );
          appendDroidOutput?.(`[Updated GitHub issue #${shard.issueNumber} to ${newStatus}]\n`);
        } catch (err) {
          appendDroidOutput?.(`[Warning: Failed to update GitHub issue #${shard.issueNumber}]\n`);
        }
      }

      // Note: We do NOT remove the worktree - it contains the committed work
      // The worktree will be used in the review phase for merging

      onStatusChange({
        ...sprintStatus,
        sprint: { ...sprintStatus.sprint, shards: finalShards },
        counts: calculateCounts(finalShards),
        activeDroids: sprintStatus.activeDroids.filter((d) => d.shardId !== shard.id),
      });

      setMessage({
        type: result.success ? "success" : "error",
        text: result.success ? `${shard.title} completed` : `${shard.title} failed`,
      });
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to start shard",
      });
    }

    setLoading(false);
  };

  const handleSelect = async (value: string) => {
    if (value === "back") {
      onBack();
    } else if (value === "view-droids") {
      // Navigate to droid viewer (if there are running droids)
      const firstDroid = runningDroids?.[0];
      if (firstDroid && onViewDroid) {
        onViewDroid(firstDroid.shardId);
      } else {
        setMessage({ type: "info", text: "No droids are currently running" });
      }
    } else if (value === "start-all") {
      if (runMode === "auto") {
        // Start shards sequentially in auto mode
        for (const shard of readyShardObjects) {
          await startShard(shard);
        }
      } else {
        // Can't start all in interactive mode
        setMessage({ type: "info", text: "Switch to Auto mode to start all shards" });
      }
    } else if (value.startsWith("run-")) {
      const shardId = value.replace("run-", "");
      const shard = sprintStatus.sprint.shards.find((s) => s.id === shardId);
      if (shard) {
        if (runMode === "interactive" && onStartChat) {
          // Interactive mode - check for existing work, then create worktree and start chat
          setLoading(true);
          setLoadingMessage(`Checking ${shard.title}...`);
          
          try {
            const worktreePath = join(projectPath, config.paths.worktrees, shard.id);
            const branchName = `${sprintStatus.sprint.branch}-${shard.id}`;
            
            // Check for existing work on this shard branch
            const existingWork = await hasShardWork(branchName, sprintStatus.sprint.branch, projectPath);
            
            if (existingWork.hasCommits && workMode === "skip") {
              // Skip this shard - it has existing work
              setMessage({ 
                type: "info", 
                text: `Skipped ${shard.title} - has ${existingWork.commitCount} existing commit(s). Use Rebuild mode to redo.` 
              });
              setLoading(false);
              return;
            }
            
            setLoadingMessage(`Creating worktree for ${shard.title}...`);
            
            // Determine base branch for stacking (same as auto mode)
            let baseBranch: string | undefined;
            if (shard.dependencies.length > 0) {
              const completedDeps = shard.dependencies
                .map(depId => sprintStatus.sprint.shards.find(s => s.id === depId))
                .filter(s => s && (s.status === "Done" || s.status === "Ready for Review") && s.branch);
              
              if (completedDeps.length > 0) {
                const lastDep = completedDeps[completedDeps.length - 1];
                baseBranch = lastDep?.branch;
              }
            }
            
            // Create worktree
            const worktreeResult = await createWorktreeWithNewBranch(worktreePath, branchName, projectPath, baseBranch);
            
            if (!worktreeResult.success) {
              setMessage({ type: "error", text: `Failed to create worktree: ${worktreeResult.error}` });
              setLoading(false);
              return;
            }
            
            // Update shard status to In Progress
            const updatedShards = sprintStatus.sprint.shards.map((s) =>
              s.id === shard.id ? { ...s, status: "In Progress" as ColumnName, worktree: worktreePath, branch: branchName } : s
            );
            
            onStatusChange({
              ...sprintStatus,
              sprint: { ...sprintStatus.sprint, shards: updatedShards },
              counts: calculateCounts(updatedShards),
            });
            
            // Read shard content for prompt
            const shardContent = await readShard(join(projectPath, shard.file));
            const prompt = `I'm working on shard: ${shard.title}

Please read the shard file at ${shard.file} and help me implement it.

## Task
${shardContent?.task || "See shard file for details."}

## Acceptance Criteria
${shardContent?.acceptanceCriteria.map((c) => `- ${c}`).join("\n") || "See shard file"}

## Working Directory
You are working in an isolated worktree: ${worktreePath}
Branch: ${branchName}
${baseBranch ? `Stacked from: ${baseBranch}` : ""}

All changes should be committed to this worktree when complete.

Let's start by reviewing the requirements and then implementing step by step.`;
            
            setLoading(false);
            // Pass worktree path to chat
            onStartChat(shard, prompt, worktreePath);
          } catch (err) {
            setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to start interactive mode" });
            setLoading(false);
          }
        } else {
          // Auto mode - run headless
          await startShard(shard);
        }
      }
    }
  };

  // Build menu items with work status hints
  const menuItems: MenuItem[] = [
    {
      label: `Start All Ready (${runMode === "auto" ? "Auto" : "Interactive"})`,
      value: "start-all",
      hint: workMode === "skip" 
        ? `${readyWithoutWork.length} to run, ${readyWithWork.length} will skip`
        : `${readyShardObjects.length} shards (rebuild mode)`,
      disabled: readyShardObjects.length === 0,
    },
    ...readyShardObjects.map((shard) => {
      const workCount = shardsWithWork.get(shard.id);
      return {
        label: shard.title,
        value: `run-${shard.id}`,
        hint: workCount 
          ? `${shard.type} • ${workCount} commit${workCount > 1 ? "s" : ""} (${workMode === "skip" ? "will skip" : "will rebuild"})`
          : shard.type,
      };
    }),
    {
      label: "View Active Droids",
      value: "view-droids",
      hint: `${sprintStatus.activeDroids.length} running`,
    },
    {
      label: "Back",
      value: "back",
    },
  ];

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="blue">Build Phase</Text>
        <Text color="gray"> • Mode: </Text>
        <Text color={runMode === "auto" ? "green" : "cyan"} bold>
          {runMode === "auto" ? "Auto (headless)" : "Interactive (chat)"}
        </Text>
        <Text color="gray"> • Work: </Text>
        <Text color={workMode === "skip" ? "yellow" : "red"} bold>
          {workMode === "skip" ? "Skip Completed" : "Rebuild All"}
        </Text>
      </Box>
      <Box marginBottom={1}>
        {checkingWork ? (
          <Text color="gray">Checking for existing work...</Text>
        ) : (
          <>
            <Text>Ready: {readyShardObjects.length}</Text>
            {shardsWithWork.size > 0 && workMode === "skip" && (
              <Text color="yellow"> ({readyWithWork.length} have work, will skip)</Text>
            )}
            <Text> | In Progress: {sprintStatus.counts.inProgress}</Text>
            <Text> | Complete: {sprintStatus.counts.readyForReview}</Text>
          </>
        )}
      </Box>
      <Menu items={menuItems} onSelect={handleSelect} />
      <Box marginTop={1} flexDirection="column">
        <Text color="gray" dimColor>Shift+Tab: toggle Auto/Interactive • Alt+S: toggle Skip/Rebuild</Text>
      </Box>
    </Box>
  );
}

function ReviewPhase({
  config,
  projectPath,
  sprintStatus,
  onStatusChange,
  onBack,
  setLoading,
  setLoadingMessage,
  setMessage,
  appendDroidOutput,
}: PhaseProps) {
  const readyForReview = sprintStatus.sprint.shards.filter((s) => s.status === "Ready for Review");
  const [mergeResults, setMergeResults] = React.useState<Map<string, { merged: boolean; buildPassed: boolean; error?: string }>>(new Map());

  // Sort shards by ID to merge in order (shard-00, shard-01, etc.)
  const sortedShards = [...readyForReview].sort((a, b) => a.id.localeCompare(b.id));

  const runBuildVerification = async () => {
    setLoading(true);
    appendDroidOutput?.("\n=== Starting Build Verification ===\n");
    
    const reviewPath = join(projectPath, config.paths.worktrees, "review");
    const results = new Map<string, { merged: boolean; buildPassed: boolean; error?: string }>();
    
    // Enable git debug
    setGitDebugCallback((msg) => appendDroidOutput?.(msg));
    
    // Create review worktree from sprint branch
    setLoadingMessage("Creating review worktree...");
    appendDroidOutput?.(`\n[review] Creating worktree from ${sprintStatus.sprint.branch}\n`);
    
    const { createReviewWorktree, cherryPickBranch } = await import("../lib/git.js");
    const wtResult = await createReviewWorktree(sprintStatus.sprint.branch, reviewPath, projectPath);
    
    if (!wtResult.success) {
      setGitDebugCallback(null);
      setMessage({ type: "error", text: `Failed to create review worktree: ${wtResult.error}` });
      setLoading(false);
      return;
    }
    
    appendDroidOutput?.(`[review] Review worktree created at ${reviewPath}\n\n`);
    
    // Merge each shard branch sequentially
    for (const shard of sortedShards) {
      const shardBranch = shard.branch || `${sprintStatus.sprint.branch}-${shard.id}`;
      setLoadingMessage(`Merging ${shard.title}...`);
      appendDroidOutput?.(`\n[review] === Merging ${shard.id}: ${shard.title} ===\n`);
      appendDroidOutput?.(`[review] Branch: ${shardBranch}\n`);
      
      // Cherry-pick commits from shard branch
      const mergeResult = await cherryPickBranch(shardBranch, reviewPath);
      
      if (!mergeResult.success) {
        appendDroidOutput?.(`[review] FAILED: ${mergeResult.error}\n`);
        results.set(shard.id, { merged: false, buildPassed: false, error: mergeResult.error });
        // Stop here - can't continue if merge fails
        break;
      }
      
      appendDroidOutput?.(`[review] Merge successful\n`);
      
      // Run build verification
      setLoadingMessage(`Verifying build after ${shard.title}...`);
      appendDroidOutput?.(`[review] Running build verification...\n`);
      
      const { spawn } = await import("child_process");
      
      // Check for package.json to determine build commands
      const { existsSync } = await import("fs");
      const hasPackageJson = existsSync(join(reviewPath, "package.json"));
      
      if (hasPackageJson) {
        // Run typecheck and build
        const buildCommands = [
          { cmd: "bun", args: ["install"], name: "install" },
          { cmd: "bun", args: ["run", "typecheck"], name: "typecheck" },
          { cmd: "bun", args: ["run", "build"], name: "build" },
        ];
        
        let buildPassed = true;
        let buildError: string | undefined;
        
        for (const { cmd, args, name } of buildCommands) {
          appendDroidOutput?.(`[review] Running ${name}...\n`);
          
          const result = await new Promise<{ success: boolean; output: string }>((resolve) => {
            const proc = spawn(cmd, args, { cwd: reviewPath, stdio: ["pipe", "pipe", "pipe"] });
            let output = "";
            proc.stdout.on("data", (d) => { output += d.toString(); });
            proc.stderr.on("data", (d) => { output += d.toString(); });
            proc.on("close", (code) => resolve({ success: code === 0, output }));
            proc.on("error", (e) => resolve({ success: false, output: e.message }));
          });
          
          if (!result.success) {
            appendDroidOutput?.(`[review] ${name} FAILED:\n${result.output.slice(-500)}\n`);
            buildPassed = false;
            buildError = `${name} failed`;
            break;
          }
          appendDroidOutput?.(`[review] ${name} passed\n`);
        }
        
        results.set(shard.id, { merged: true, buildPassed, error: buildError });
        
        if (!buildPassed) {
          appendDroidOutput?.(`[review] Build verification FAILED for ${shard.id}\n`);
          // Don't stop - continue to show which shards pass/fail
        } else {
          appendDroidOutput?.(`[review] Build verification PASSED for ${shard.id}\n`);
        }
      } else {
        // No package.json - assume build passes
        appendDroidOutput?.(`[review] No package.json found - skipping build verification\n`);
        results.set(shard.id, { merged: true, buildPassed: true });
      }
    }
    
    setGitDebugCallback(null);
    setMergeResults(results);
    
    // Update shard statuses based on results
    const updatedShards = sprintStatus.sprint.shards.map((s) => {
      const result = results.get(s.id);
      if (result?.merged && result?.buildPassed) {
        return { ...s, status: "In Review" as ColumnName };
      } else if (result && !result.buildPassed) {
        // Send back to build phase
        return { ...s, status: "In Progress" as ColumnName };
      }
      return s;
    });
    
    onStatusChange({
      ...sprintStatus,
      sprint: { ...sprintStatus.sprint, shards: updatedShards },
      counts: calculateCounts(updatedShards),
    });
    
    const passedCount = Array.from(results.values()).filter(r => r.merged && r.buildPassed).length;
    const failedCount = Array.from(results.values()).filter(r => !r.buildPassed).length;
    
    appendDroidOutput?.(`\n=== Build Verification Complete ===\n`);
    appendDroidOutput?.(`Passed: ${passedCount} | Failed: ${failedCount}\n`);
    
    if (failedCount > 0) {
      setMessage({ type: "error", text: `${failedCount} shard(s) failed build verification` });
    } else {
      setMessage({ type: "success", text: `All ${passedCount} shards passed build verification` });
    }
    
    setLoading(false);
  };

  const runDroidReview = async (shard: Shard, reviewType: "implementation" | "code") => {
    setLoading(true);
    setLoadingMessage(`Running ${reviewType} review on ${shard.title}...`);

    const droidName = reviewType === "implementation" ? "implementation-reviewer" : "code-reviewer";
    const reviewPath = join(projectPath, config.paths.worktrees, "review");

    const prompt =
      reviewType === "implementation"
        ? `Review the implementation of shard: ${shard.title}

Read the shard file: ${shard.file}

Verify ALL requirements are implemented.
Check all acceptance criteria are met.

If gaps found, report them clearly.
Return: COMPLIANT or NON-COMPLIANT with details.`
        : `Review code quality for shard: ${shard.title}

Files to review are in the shard file: ${shard.file}

Check against coding standards.
Look for: security issues, performance problems, code smells.

Return: APPROVED or CHANGES_REQUESTED with details.`;

    const result = await invokeDroid(
      {
        droid: droidName,
        prompt,
        autoLevel: "low",
        model: config.droids.model,
        cwd: reviewPath, // Run in review worktree
      },
      (chunk) => appendDroidOutput?.(chunk)
    );

    const passed =
      result.output.includes("COMPLIANT") ||
      result.output.includes("APPROVED");

    if (passed) {
      const updatedShards = sprintStatus.sprint.shards.map((s) =>
        s.id === shard.id ? { ...s, status: "Ready for UAT" as ColumnName } : s
      );
      onStatusChange({
        ...sprintStatus,
        sprint: { ...sprintStatus.sprint, shards: updatedShards },
        counts: calculateCounts(updatedShards),
      });
      setMessage({ type: "success", text: `${shard.title} passed ${reviewType} review` });
    } else {
      setMessage({ type: "error", text: `${shard.title} needs changes` });
    }

    setLoading(false);
  };

  const inReview = sprintStatus.sprint.shards.filter((s) => s.status === "In Review");
  
  // Check if all reviewed shards passed (ready to finalize)
  const allPassed = inReview.length > 0 && 
    Array.from(mergeResults.values()).every(r => r.merged && r.buildPassed) &&
    mergeResults.size === readyForReview.length + inReview.length;

  const finalizeAndPush = async () => {
    setLoading(true);
    setLoadingMessage("Finalizing review and pushing to sprint branch...");
    appendDroidOutput?.("\n=== Finalizing Review ===\n");
    
    const reviewPath = join(projectPath, config.paths.worktrees, "review");
    
    // Enable git debug
    setGitDebugCallback((msg) => appendDroidOutput?.(msg));
    
    // Import and call finalizeReview
    const { finalizeReview, cleanupShardWorktrees } = await import("../lib/git.js");
    
    const result = await finalizeReview(
      sprintStatus.sprint.branch,
      reviewPath,
      projectPath
    );
    
    if (!result.success) {
      setGitDebugCallback(null);
      setMessage({ type: "error", text: `Failed to finalize: ${result.error}` });
      setLoading(false);
      return;
    }
    
    appendDroidOutput?.("[finalize] Sprint branch updated and pushed\n");
    
    // Clean up shard worktrees
    const shardIds = inReview.map(s => s.id);
    appendDroidOutput?.(`[finalize] Cleaning up ${shardIds.length} shard worktree(s)...\n`);
    await cleanupShardWorktrees(shardIds, join(projectPath, config.paths.worktrees), projectPath);
    
    setGitDebugCallback(null);
    
    // Update shard statuses to Ready for UAT
    const updatedShards = sprintStatus.sprint.shards.map((s) => {
      if (s.status === "In Review") {
        return { ...s, status: "Ready for UAT" as ColumnName };
      }
      return s;
    });
    
    // Update GitHub issue labels
    for (const shard of inReview) {
      if (shard.issueNumber) {
        try {
          const { updateIssueLabels } = await import("../lib/github.js");
          await updateIssueLabels(shard.issueNumber, "Ready for UAT");
          appendDroidOutput?.(`[finalize] Updated issue #${shard.issueNumber} to Ready for UAT\n`);
        } catch {
          appendDroidOutput?.(`[finalize] Warning: Failed to update issue #${shard.issueNumber}\n`);
        }
      }
    }
    
    onStatusChange({
      ...sprintStatus,
      sprint: { ...sprintStatus.sprint, shards: updatedShards },
      counts: calculateCounts(updatedShards),
    });
    
    appendDroidOutput?.("\n=== Review Finalized Successfully ===\n");
    appendDroidOutput?.("Code has been pushed to the sprint branch.\n");
    appendDroidOutput?.("Shards are now Ready for UAT.\n");
    
    setMessage({ type: "success", text: "Review finalized! Code pushed to sprint branch. Ready for UAT." });
    setLoading(false);
  };

  const menuItems: MenuItem[] = [
    {
      label: "Run Build Verification",
      value: "build-verify",
      hint: `Merge & verify ${readyForReview.length} shards`,
      disabled: readyForReview.length === 0,
    },
    {
      label: "Run Implementation Review",
      value: "impl-review",
      hint: `${inReview.length} in review`,
      disabled: inReview.length === 0,
    },
    {
      label: "Run Code Review",
      value: "code-review",
      hint: `${inReview.length} in review`,
      disabled: inReview.length === 0,
    },
    {
      label: "Finalize & Push to Sprint Branch",
      value: "finalize",
      hint: allPassed ? `Push ${inReview.length} shard(s) to ${sprintStatus.sprint.branch}` : "Run reviews first",
      disabled: !allPassed && inReview.length === 0,
    },
    {
      label: "Back",
      value: "back",
    },
  ];

  return (
    <Box flexDirection="column">
      <Text bold color="yellow">
        Review Phase
      </Text>
      <Box marginY={1} flexDirection="column">
        <Text>Ready for Review: {readyForReview.length}</Text>
        <Text>In Review: {inReview.length}</Text>
        {mergeResults.size > 0 && (
          <Box marginTop={1} flexDirection="column">
            <Text bold>Merge Results:</Text>
            {Array.from(mergeResults.entries()).map(([id, result]) => (
              <Text key={id} color={result.buildPassed ? "green" : "red"}>
                {result.buildPassed ? "✓" : "✗"} {id}: {result.error || "OK"}
              </Text>
            ))}
          </Box>
        )}
        {inReview.length > 0 && (
          <Box marginTop={1}>
            <Text color={allPassed ? "green" : "gray"}>
              {allPassed 
                ? "All reviews passed - ready to finalize and push!" 
                : "Complete reviews before finalizing"}
            </Text>
          </Box>
        )}
      </Box>
      <Menu
        items={menuItems}
        onSelect={async (value) => {
          if (value === "back") {
            onBack();
          } else if (value === "build-verify") {
            await runBuildVerification();
          } else if (value === "impl-review" && inReview[0]) {
            await runDroidReview(inReview[0], "implementation");
          } else if (value === "code-review" && inReview[0]) {
            await runDroidReview(inReview[0], "code");
          } else if (value === "finalize") {
            await finalizeAndPush();
          }
        }}
      />
    </Box>
  );
}

function UatPhase({
  config,
  projectPath,
  sprintStatus,
  onStatusChange,
  onBack,
  setLoading,
  setLoadingMessage,
  setMessage,
  appendDroidOutput,
}: PhaseProps) {
  const readyForUat = sprintStatus.sprint.shards.filter((s) => s.status === "Ready for UAT");

  const runUat = async (shard: Shard) => {
    setLoading(true);
    setLoadingMessage(`Running UAT on ${shard.title}...`);

    const prompt = `Execute UAT for shard: ${shard.title}

Application URL: ${config.app_url}
Shard file: ${shard.file}

1. Read the shard file for acceptance criteria
2. Navigate to the application
3. Execute each test scenario
4. Report PASS or FAIL for each criterion

Return results in format:
- Criterion 1: PASS/FAIL
- Criterion 2: PASS/FAIL
...
OVERALL: PASS/FAIL`;

    const result = await invokeDroid(
      {
        droid: "uat-runner",
        prompt,
        autoLevel: "high",
        model: config.droids.model,
        cwd: projectPath,
      },
      (chunk) => appendDroidOutput?.(chunk)
    );

    const passed = result.output.includes("OVERALL: PASS");

    const newStatus: ColumnName = passed ? "User Acceptance" : "Ready to Build";
    const updatedShards = sprintStatus.sprint.shards.map((s) =>
      s.id === shard.id ? { ...s, status: newStatus } : s
    );

    onStatusChange({
      ...sprintStatus,
      sprint: { ...sprintStatus.sprint, shards: updatedShards },
      counts: calculateCounts(updatedShards),
    });

    setMessage({
      type: passed ? "success" : "error",
      text: passed ? `${shard.title} passed UAT` : `${shard.title} failed UAT`,
    });

    setLoading(false);
  };

  const menuItems: MenuItem[] = [
    {
      label: "Run UAT Tests",
      value: "run-uat",
      hint: `${readyForUat.length} ready`,
      disabled: readyForUat.length === 0,
    },
    {
      label: "Back",
      value: "back",
    },
  ];

  return (
    <Box flexDirection="column">
      <Text bold color="magenta">
        UAT Phase
      </Text>
      <Box marginY={1}>
        <Text>Ready for UAT: {readyForUat.length}</Text>
      </Box>
      <Menu
        items={menuItems}
        onSelect={async (value) => {
          if (value === "back") {
            onBack();
          } else if (value === "run-uat" && readyForUat[0]) {
            await runUat(readyForUat[0]);
          }
        }}
      />
    </Box>
  );
}

function UserAcceptancePhase({
  sprintStatus,
  onStatusChange,
  onBack,
}: {
  sprintStatus: SprintStatus;
  onStatusChange: (status: SprintStatus) => void;
  onBack: () => void;
}) {
  const awaitingAcceptance = sprintStatus.sprint.shards.filter((s) => s.status === "User Acceptance");

  const approveShard = (shard: Shard) => {
    const updatedShards = sprintStatus.sprint.shards.map((s) =>
      s.id === shard.id ? { ...s, status: "Done" as ColumnName } : s
    );
    onStatusChange({
      ...sprintStatus,
      sprint: { ...sprintStatus.sprint, shards: updatedShards },
      counts: calculateCounts(updatedShards),
    });
  };

  const rejectShard = (shard: Shard) => {
    const updatedShards = sprintStatus.sprint.shards.map((s) =>
      s.id === shard.id ? { ...s, status: "Ready to Build" as ColumnName } : s
    );
    onStatusChange({
      ...sprintStatus,
      sprint: { ...sprintStatus.sprint, shards: updatedShards },
      counts: calculateCounts(updatedShards),
    });
  };

  const menuItems: MenuItem[] = [
    ...awaitingAcceptance.map((shard) => ({
      label: `Approve: ${shard.title}`,
      value: `approve-${shard.id}`,
    })),
    ...awaitingAcceptance.map((shard) => ({
      label: `Reject: ${shard.title}`,
      value: `reject-${shard.id}`,
    })),
    {
      label: "Approve All",
      value: "approve-all",
      disabled: awaitingAcceptance.length === 0,
    },
    {
      label: "Back",
      value: "back",
    },
  ];

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        User Acceptance
      </Text>
      <Box marginY={1}>
        <Text>Awaiting acceptance: {awaitingAcceptance.length}</Text>
      </Box>
      <Menu
        items={menuItems}
        onSelect={(value) => {
          if (value === "back") {
            onBack();
          } else if (value === "approve-all") {
            awaitingAcceptance.forEach(approveShard);
          } else if (value.startsWith("approve-")) {
            const shardId = value.replace("approve-", "");
            const shard = awaitingAcceptance.find((s) => s.id === shardId);
            if (shard) approveShard(shard);
          } else if (value.startsWith("reject-")) {
            const shardId = value.replace("reject-", "");
            const shard = awaitingAcceptance.find((s) => s.id === shardId);
            if (shard) rejectShard(shard);
          }
        }}
      />
    </Box>
  );
}

function DeployPhase({
  config,
  projectPath,
  sprintStatus,
  onBack,
  setLoading,
  setLoadingMessage,
  setMessage,
}: Omit<PhaseProps, "onStatusChange" | "appendDroidOutput">) {
  const runDeploy = async (action: string) => {
    setLoading(true);

    try {
      switch (action) {
        case "rebase":
          setLoadingMessage("Rebasing stack...");
          const rebaseResult = await rebaseStack("main", projectPath);
          if (!rebaseResult.success) {
            throw new Error(`Rebase failed on branch: ${rebaseResult.failedBranch}`);
          }
          setMessage({ type: "success", text: "Stack rebased successfully" });
          break;

        case "push":
          setLoadingMessage("Pushing to remote...");
          const branch = await getCurrentBranch(projectPath);
          const pushSuccess = await push("origin", branch || undefined, true, projectPath);
          if (!pushSuccess) {
            throw new Error("Push failed");
          }
          setMessage({ type: "success", text: "Pushed to remote" });
          break;

        case "merge":
          setMessage({ type: "info", text: "Squash merge should be done via GitHub PR" });
          break;

        case "archive":
          setMessage({ type: "info", text: "Archive board via GitHub Projects UI" });
          break;
      }
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Deploy action failed",
      });
    }

    setLoading(false);
  };

  const menuItems: MenuItem[] = [
    { label: "Rebase Stack", value: "rebase" },
    { label: "Push to Remote", value: "push" },
    { label: "Squash Merge (via GitHub)", value: "merge" },
    { label: "Archive Board", value: "archive" },
    { label: "Back", value: "back" },
  ];

  return (
    <Box flexDirection="column">
      <Text bold color="green">
        Deploy Phase
      </Text>
      <Box marginY={1}>
        <Text>All shards complete. Ready to deploy.</Text>
      </Box>
      <Menu
        items={menuItems}
        onSelect={(value) => {
          if (value === "back") {
            onBack();
          } else {
            runDeploy(value);
          }
        }}
      />
    </Box>
  );
}
