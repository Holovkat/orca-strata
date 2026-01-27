import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { Menu, type MenuItem } from "../components/Menu.js";
import { QuestionPrompt } from "../components/QuestionPrompt.js";
import { Spinner } from "../components/Spinner.js";
import { StatusMessage } from "../components/StatusMessage.js";
import { invokeDroid, listAvailableDroids } from "../lib/droid.js";
import {
  listWorktrees,
  removeWorktree,
  pruneWorktrees,
  getCurrentBranch,
  listBranches,
  rebaseStack,
  push,
} from "../lib/git.js";
import type { OrcaConfig } from "../lib/types.js";

interface ManualActionsProps {
  config: OrcaConfig;
  projectPath: string;
  onBack: () => void;
  onStartChat?: (prompt: string) => void;
}

type SubScreen =
  | "menu"
  | "invoke-droid"
  | "run-checks"
  | "manage-worktrees"
  | "git-operations";

export function ManualActions({ config, projectPath, onBack, onStartChat }: ManualActionsProps) {
  const [subScreen, setSubScreen] = useState<SubScreen>("menu");
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [message, setMessage] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);
  const [droidOutput, setDroidOutput] = useState("");

  const appendDroidOutput = useCallback((chunk: string) => {
    setDroidOutput((prev) => prev + chunk);
  }, []);

  const clearDroidOutput = useCallback(() => {
    setDroidOutput("");
  }, []);

  useInput((input, key) => {
    if (key.escape && !loading) {
      if (subScreen === "menu") {
        onBack();
      } else {
        setSubScreen("menu");
        setMessage(null);
        clearDroidOutput();
      }
    }
  });

  const menuItems: MenuItem[] = [
    {
      label: "Invoke Droid",
      value: "invoke-droid",
      hint: "Run a droid with custom prompt",
    },
    {
      label: "Run Checks",
      value: "run-checks",
      hint: "Lint, typecheck, build",
    },
    {
      label: "Manage Worktrees",
      value: "manage-worktrees",
      hint: "List, create, remove worktrees",
    },
    {
      label: "Git Operations",
      value: "git-operations",
      hint: "Branch, rebase, merge",
    },
    {
      label: "Back",
      value: "back",
    },
  ];

  const renderSubScreen = () => {
    switch (subScreen) {
      case "invoke-droid":
        return (
          <InvokeDroidScreen
            config={config}
            projectPath={projectPath}
            setLoading={setLoading}
            setLoadingMessage={setLoadingMessage}
            setMessage={setMessage}
            appendDroidOutput={appendDroidOutput}
            onBack={() => setSubScreen("menu")}
            onStartChat={onStartChat}
          />
        );
      case "run-checks":
        return (
          <RunChecksScreen
            projectPath={projectPath}
            setLoading={setLoading}
            setLoadingMessage={setLoadingMessage}
            setMessage={setMessage}
            onBack={() => setSubScreen("menu")}
          />
        );
      case "manage-worktrees":
        return (
          <WorktreesScreen
            projectPath={projectPath}
            setLoading={setLoading}
            setLoadingMessage={setLoadingMessage}
            setMessage={setMessage}
            onBack={() => setSubScreen("menu")}
          />
        );
      case "git-operations":
        return (
          <GitOperationsScreen
            projectPath={projectPath}
            setLoading={setLoading}
            setLoadingMessage={setLoadingMessage}
            setMessage={setMessage}
            onBack={() => setSubScreen("menu")}
          />
        );
      default:
        return (
          <Menu
            items={menuItems}
            onSelect={(value) => {
              if (value === "back") {
                onBack();
              } else {
                setSubScreen(value as SubScreen);
              }
            }}
            title="Manual Actions"
          />
        );
    }
  };

  return (
    <Box flexDirection="column">
      {message && (
        <Box marginBottom={1}>
          <StatusMessage type={message.type} message={message.text} />
        </Box>
      )}
      {loading ? (
        <Box flexDirection="column">
          <Spinner message={loadingMessage} />
          {droidOutput && (
            <Box marginTop={1}>
              <Text color="gray">{droidOutput.slice(-500)}</Text>
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

interface SubScreenProps {
  projectPath: string;
  setLoading: (loading: boolean) => void;
  setLoadingMessage: (msg: string) => void;
  setMessage: (msg: { type: "success" | "error" | "info"; text: string } | null) => void;
  onBack: () => void;
}

type InvokeDroidStep = "select-droid" | "select-mode" | "enter-prompt";

function InvokeDroidScreen({
  config,
  projectPath,
  setLoading,
  setLoadingMessage,
  setMessage,
  appendDroidOutput,
  onBack,
  onStartChat,
}: SubScreenProps & { 
  config: OrcaConfig; 
  appendDroidOutput: (chunk: string) => void;
  onStartChat?: (prompt: string) => void;
}) {
  const [step, setStep] = useState<InvokeDroidStep>("select-droid");
  const [selectedDroid, setSelectedDroid] = useState<string>("");
  const [selectedMode, setSelectedMode] = useState<"auto" | "chat">("auto");
  const [availableDroids, setAvailableDroids] = useState<string[]>([]);

  useEffect(() => {
    listAvailableDroids().then(setAvailableDroids);
  }, []);

  const runDroidAuto = async (prompt: string) => {
    setLoading(true);
    setLoadingMessage(`Running ${selectedDroid}...`);

    try {
      const result = await invokeDroid(
        {
          droid: selectedDroid,
          prompt,
          autoLevel: config.droids.auto_level,
          cwd: projectPath,
        },
        config,
        (chunk) => appendDroidOutput(chunk)
      );

      setMessage({
        type: result.success ? "success" : "error",
        text: result.success ? `${selectedDroid} completed` : `${selectedDroid} failed`,
      });
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Droid invocation failed",
      });
    }

    setLoading(false);
    onBack();
  };

  const startChatSession = (prompt: string) => {
    if (onStartChat) {
      // Wrap the prompt with droid context
      const fullPrompt = `You are acting as the ${selectedDroid} droid.

${prompt}`;
      onStartChat(fullPrompt);
    } else {
      setMessage({
        type: "error",
        text: "Interactive chat not available in this context",
      });
      onBack();
    }
  };

  // Step 1: Select droid
  if (step === "select-droid") {
    if (availableDroids.length === 0) {
      return <Spinner message="Loading available droids..." />;
    }

    const droidItems: MenuItem[] = [
      ...availableDroids.map((droid) => ({
        label: droid,
        value: droid,
      })),
      { label: "Cancel", value: "__cancel__" },
    ];

    return (
      <Box flexDirection="column">
        <Text bold color="cyan">Select Droid</Text>
        <Text color="gray" dimColor>{availableDroids.length} droids available in ~/.factory/droids/</Text>
        <Box marginTop={1}>
          <Menu
            items={droidItems}
            onSelect={(value) => {
              if (value === "__cancel__") {
                onBack();
              } else {
                setSelectedDroid(value);
                setStep("select-mode");
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  // Step 2: Select mode (auto or chat)
  if (step === "select-mode") {
    const modeItems: MenuItem[] = [
      {
        label: "Auto (Headless)",
        value: "auto",
        hint: "Run to completion, show output",
      },
      {
        label: "Interactive Chat",
        value: "chat",
        hint: "Multi-turn conversation",
      },
      { label: "Back", value: "__back__" },
    ];

    return (
      <Box flexDirection="column">
        <Text bold color="cyan">Invoke: {selectedDroid}</Text>
        <Text color="gray" dimColor>How do you want to run this droid?</Text>
        <Box marginTop={1}>
          <Menu
            items={modeItems}
            onSelect={(value) => {
              if (value === "__back__") {
                setStep("select-droid");
              } else {
                setSelectedMode(value as "auto" | "chat");
                setStep("enter-prompt");
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  // Step 3: Enter prompt
  return (
    <Box flexDirection="column">
      <Text bold color="cyan">Invoke: {selectedDroid}</Text>
      <Text color="gray" dimColor>Mode: {selectedMode === "auto" ? "Headless" : "Interactive"}</Text>
      <Box marginTop={1}>
        <QuestionPrompt
          question="Enter your prompt for the droid:"
          type="text"
          onAnswer={(prompt) => {
            if (selectedMode === "chat") {
              startChatSession(prompt);
            } else {
              runDroidAuto(prompt);
            }
          }}
          onCancel={() => setStep("select-mode")}
        />
      </Box>
    </Box>
  );
}

function RunChecksScreen({
  projectPath,
  setLoading,
  setLoadingMessage,
  setMessage,
  onBack,
}: SubScreenProps) {
  const { spawn } = require("child_process");

  const runCommand = async (name: string, cmd: string, args: string[]) => {
    setLoading(true);
    setLoadingMessage(`Running ${name}...`);

    return new Promise<void>((resolve) => {
      const proc = spawn(cmd, args, {
        cwd: projectPath,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let output = "";
      proc.stdout.on("data", (data: Buffer) => {
        output += data.toString();
      });
      proc.stderr.on("data", (data: Buffer) => {
        output += data.toString();
      });

      proc.on("close", (code: number) => {
        setLoading(false);
        setMessage({
          type: code === 0 ? "success" : "error",
          text: code === 0 ? `${name} passed` : `${name} failed`,
        });
        resolve();
      });
    });
  };

  const menuItems: MenuItem[] = [
    { label: "Run Lint", value: "lint" },
    { label: "Run Typecheck", value: "typecheck" },
    { label: "Run Build", value: "build" },
    { label: "Run All", value: "all" },
    { label: "Back", value: "back" },
  ];

  return (
    <Box flexDirection="column">
      <Text bold>Run Checks</Text>
      <Menu
        items={menuItems}
        onSelect={async (value) => {
          if (value === "back") {
            onBack();
          } else if (value === "lint") {
            await runCommand("Lint", "bun", ["run", "lint"]);
          } else if (value === "typecheck") {
            await runCommand("Typecheck", "bun", ["run", "typecheck"]);
          } else if (value === "build") {
            await runCommand("Build", "bun", ["run", "build"]);
          } else if (value === "all") {
            await runCommand("Lint", "bun", ["run", "lint"]);
            await runCommand("Typecheck", "bun", ["run", "typecheck"]);
            await runCommand("Build", "bun", ["run", "build"]);
          }
        }}
      />
    </Box>
  );
}

function WorktreesScreen({
  projectPath,
  setLoading,
  setLoadingMessage,
  setMessage,
  onBack,
}: SubScreenProps) {
  const [worktrees, setWorktrees] = useState<Array<{ path: string; branch: string; head: string }>>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    listWorktrees(projectPath).then(setWorktrees);
  }, [projectPath, refreshKey]);

  const refresh = () => setRefreshKey((k) => k + 1);

  const menuItems: MenuItem[] = [
    { label: "Refresh List", value: "refresh" },
    { label: "Prune Stale Worktrees", value: "prune" },
    ...worktrees.slice(1).map((wt) => ({
      label: `Remove: ${wt.branch}`,
      value: `remove-${wt.path}`,
      hint: wt.path,
    })),
    { label: "Back", value: "back" },
  ];

  return (
    <Box flexDirection="column">
      <Text bold>Manage Worktrees</Text>
      <Box marginY={1} flexDirection="column">
        <Text color="gray">Current worktrees:</Text>
        {worktrees.map((wt, i) => (
          <Text key={wt.path} color={i === 0 ? "cyan" : "white"}>
            {i === 0 ? "● " : "  "}
            {wt.branch} → {wt.path}
          </Text>
        ))}
      </Box>
      <Menu
        items={menuItems}
        onSelect={async (value) => {
          if (value === "back") {
            onBack();
          } else if (value === "refresh") {
            refresh();
          } else if (value === "prune") {
            setLoading(true);
            setLoadingMessage("Pruning worktrees...");
            await pruneWorktrees(projectPath);
            setLoading(false);
            setMessage({ type: "success", text: "Pruned stale worktrees" });
            refresh();
          } else if (value.startsWith("remove-")) {
            const path = value.replace("remove-", "");
            setLoading(true);
            setLoadingMessage(`Removing worktree ${path}...`);
            await removeWorktree(path, true, projectPath);
            setLoading(false);
            setMessage({ type: "success", text: "Worktree removed" });
            refresh();
          }
        }}
      />
    </Box>
  );
}

function GitOperationsScreen({
  projectPath,
  setLoading,
  setLoadingMessage,
  setMessage,
  onBack,
}: SubScreenProps) {
  const [currentBranch, setCurrentBranch] = useState<string>("");

  useEffect(() => {
    listBranches(projectPath);
    getCurrentBranch(projectPath).then((b) => setCurrentBranch(b || ""));
  }, [projectPath]);

  const menuItems: MenuItem[] = [
    { label: "Create Stacked Branch", value: "create-branch" },
    { label: "Rebase Stack", value: "rebase" },
    { label: "Push Current Branch", value: "push" },
    { label: "Push with Force-Lease", value: "push-force" },
    { label: "Back", value: "back" },
  ];

  return (
    <Box flexDirection="column">
      <Text bold>Git Operations</Text>
      <Box marginY={1}>
        <Text>Current branch: </Text>
        <Text color="cyan">{currentBranch}</Text>
      </Box>
      <Menu
        items={menuItems}
        onSelect={async (value) => {
          if (value === "back") {
            onBack();
          } else if (value === "create-branch") {
            setMessage({ type: "info", text: "Use NewSprint to create branches" });
          } else if (value === "rebase") {
            setLoading(true);
            setLoadingMessage("Rebasing stack onto main...");
            const result = await rebaseStack("main", projectPath);
            setLoading(false);
            if (result.success) {
              setMessage({ type: "success", text: "Stack rebased successfully" });
            } else {
              setMessage({ type: "error", text: `Rebase failed on: ${result.failedBranch}` });
            }
          } else if (value === "push") {
            setLoading(true);
            setLoadingMessage("Pushing...");
            const success = await push("origin", currentBranch, false, projectPath);
            setLoading(false);
            setMessage({
              type: success ? "success" : "error",
              text: success ? "Pushed successfully" : "Push failed",
            });
          } else if (value === "push-force") {
            setLoading(true);
            setLoadingMessage("Pushing with force-lease...");
            const success = await push("origin", currentBranch, true, projectPath);
            setLoading(false);
            setMessage({
              type: success ? "success" : "error",
              text: success ? "Pushed successfully" : "Push failed",
            });
          }
        }}
      />
    </Box>
  );
}
