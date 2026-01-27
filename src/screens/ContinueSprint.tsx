import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { Menu, type MenuItem } from "../components/Menu.js";
import { Spinner } from "../components/Spinner.js";
import { StatusMessage } from "../components/StatusMessage.js";
import { invokeDroid, assignDroidByShardType } from "../lib/droid.js";
import {
  createWorktreeWithNewBranch,
  removeWorktree,
  push,
  rebaseStack,
  getCurrentBranch,
} from "../lib/git.js";
import { closeIssue, updateIssueBody, addIssueLabel, removeIssueLabel } from "../lib/github.js";
import { buildDependencyGraph, getShardsReadyToRun } from "../lib/dependencies.js";
import { readShard } from "../lib/shard.js";
import type { OrcaConfig, SprintStatus, Phase, Shard, ActiveDroid, ColumnName } from "../lib/types.js";
import { join } from "path";

interface ContinueSprintProps {
  config: OrcaConfig;
  projectPath: string;
  sprintStatus: SprintStatus | null;
  onBack: () => void;
  onStatusChange: (status: SprintStatus) => void;
  onStartChat?: (shard: Shard, prompt?: string) => void;
}

type SubScreen = "menu" | "build" | "review" | "uat" | "user-acceptance" | "deploy";

export function ContinueSprint({
  config,
  projectPath,
  sprintStatus,
  onBack,
  onStatusChange,
  onStartChat,
}: ContinueSprintProps) {
  const [subScreen, setSubScreen] = useState<SubScreen>("menu");
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const [droidOutput, setDroidOutput] = useState("");

  const appendDroidOutput = useCallback((chunk: string) => {
    setDroidOutput((prev) => prev + chunk);
  }, []);

  useInput((input, key) => {
    if (key.escape && !loading) {
      if (subScreen === "menu") {
        onBack();
      } else {
        setSubScreen("menu");
        setMessage(null);
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

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="white">
          Sprint: {sprintStatus.sprint.name}
        </Text>
        <Text color="gray"> - Phase: {currentPhase}</Text>
      </Box>
      {message && (
        <Box marginBottom={1}>
          <StatusMessage type={message.type} message={message.text} />
        </Box>
      )}
      {loading ? (
        <Box flexDirection="column">
          <Spinner message={loadingMessage} />
          {droidOutput && (
            <Box marginTop={1} flexDirection="column">
              <Text color="yellow">--- Droid Output ---</Text>
              <Text color="white" wrap="wrap">{droidOutput.slice(-1000)}</Text>
            </Box>
          )}
        </Box>
      ) : (
        renderSubScreen()
      )}
      {!loading && (
        <Box marginTop={1}>
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
  onStartChat?: (shard: Shard, prompt?: string) => void;
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
}: PhaseProps) {
  const graph = buildDependencyGraph(sprintStatus.sprint.shards);
  const completedIds = new Set(
    sprintStatus.sprint.shards.filter((s) => s.status === "Done" || s.status === "Ready for Review").map((s) => s.id)
  );
  const inProgressIds = new Set(
    sprintStatus.sprint.shards.filter((s) => s.status === "In Progress").map((s) => s.id)
  );

  const readyShards = getShardsReadyToRun(graph, completedIds, inProgressIds);
  const readyShardObjects = sprintStatus.sprint.shards.filter((s) => readyShards.includes(s.id));

  const startShard = async (shard: Shard) => {
    setLoading(true);
    setLoadingMessage(`Starting ${shard.title}...`);

    try {
      // Create worktree for isolation
      const worktreePath = join(projectPath, config.paths.worktrees, shard.id);
      const branchName = `${sprintStatus.sprint.branch}-${shard.id}`;

      setLoadingMessage(`Creating worktree for ${shard.id}...`);
      await createWorktreeWithNewBranch(worktreePath, branchName, projectPath);

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
          cwd: worktreePath,
        },
        config,
        (chunk) => appendDroidOutput?.(chunk)
      );

      // Update status based on result
      const newStatus: ColumnName = result.success ? "Ready for Review" : "Ready to Build";

      const finalShards = sprintStatus.sprint.shards.map((s) =>
        s.id === shard.id ? { ...s, status: newStatus } : s
      );

      // Remove worktree if successful
      if (result.success) {
        await removeWorktree(worktreePath, true, projectPath);
      }

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

  const menuItems: MenuItem[] = [
    {
      label: "Start All Ready Shards (Auto)",
      value: "start-all",
      hint: `${readyShardObjects.length} shards ready`,
      disabled: readyShardObjects.length === 0,
    },
    ...readyShardObjects.flatMap((shard) => [
      {
        label: `Auto: ${shard.title}`,
        value: `start-${shard.id}`,
        hint: `${shard.type} - headless`,
      },
      {
        label: `Chat: ${shard.title}`,
        value: `chat-${shard.id}`,
        hint: `${shard.type} - interactive`,
      },
    ]),
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

  const handleSelect = async (value: string) => {
    if (value === "back") {
      onBack();
    } else if (value === "start-all") {
      // Start shards sequentially for now
      for (const shard of readyShardObjects) {
        await startShard(shard);
      }
    } else if (value.startsWith("chat-")) {
      const shardId = value.replace("chat-", "");
      const shard = sprintStatus.sprint.shards.find((s) => s.id === shardId);
      if (shard && onStartChat) {
        // Generate initial prompt for the chat
        const shardContent = await readShard(join(projectPath, shard.file));
        const prompt = `I'm working on shard: ${shard.title}

Please read the shard file at ${shard.file} and help me implement it.

## Task
${shardContent?.task || "See shard file for details."}

## Acceptance Criteria
${shardContent?.acceptanceCriteria.map((c) => `- ${c}`).join("\n") || "See shard file"}

Let's start by reviewing the requirements and then implementing step by step.`;
        onStartChat(shard, prompt);
      }
    } else if (value.startsWith("start-")) {
      const shardId = value.replace("start-", "");
      const shard = sprintStatus.sprint.shards.find((s) => s.id === shardId);
      if (shard) {
        await startShard(shard);
      }
    }
  };

  return (
    <Box flexDirection="column">
      <Text bold color="blue">
        Build Phase
      </Text>
      <Box marginY={1}>
        <Text>Ready: {readyShardObjects.length}</Text>
        <Text> | In Progress: {sprintStatus.counts.inProgress}</Text>
        <Text> | Complete: {sprintStatus.counts.readyForReview}</Text>
      </Box>
      <Menu items={menuItems} onSelect={handleSelect} />
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

  const runReview = async (shard: Shard, reviewType: "implementation" | "code") => {
    setLoading(true);
    setLoadingMessage(`Running ${reviewType} review on ${shard.title}...`);

    const droidName = reviewType === "implementation" ? "implementation-reviewer" : "code-reviewer";

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
        cwd: projectPath,
      },
      config,
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
      setMessage({ type: "warning" as any, text: `${shard.title} needs changes` });
    }

    setLoading(false);
  };

  const menuItems: MenuItem[] = [
    {
      label: "Run Implementation Review",
      value: "impl-review",
      hint: `${readyForReview.length} ready`,
      disabled: readyForReview.length === 0,
    },
    {
      label: "Run Code Review",
      value: "code-review",
      disabled: readyForReview.length === 0,
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
      <Box marginY={1}>
        <Text>Ready for Review: {readyForReview.length}</Text>
      </Box>
      <Menu
        items={menuItems}
        onSelect={async (value) => {
          if (value === "back") {
            onBack();
          } else if (value === "impl-review" && readyForReview[0]) {
            await runReview(readyForReview[0], "implementation");
          } else if (value === "code-review" && readyForReview[0]) {
            await runReview(readyForReview[0], "code");
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
        cwd: projectPath,
      },
      config,
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
