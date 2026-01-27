import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Menu, type MenuItem } from "../components/Menu.js";
import { QuestionPrompt } from "../components/QuestionPrompt.js";
import { Spinner } from "../components/Spinner.js";
import { StatusMessage } from "../components/StatusMessage.js";
import type { OrcaConfig } from "../lib/types.js";

interface ManualActionsProps {
  config: OrcaConfig;
  projectPath: string;
  onBack: () => void;
}

type SubScreen =
  | "menu"
  | "invoke-droid"
  | "move-issue"
  | "create-issue"
  | "run-checks"
  | "manage-worktrees"
  | "git-operations";

export function ManualActions({
  config,
  projectPath,
  onBack,
}: ManualActionsProps) {
  const [subScreen, setSubScreen] = useState<SubScreen>("menu");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  useInput((input, key) => {
    if (key.escape) {
      if (subScreen === "menu") {
        onBack();
      } else {
        setSubScreen("menu");
        setMessage(null);
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
      label: "Move Issue",
      value: "move-issue",
      hint: "Move issue to different column",
    },
    {
      label: "Create Issue",
      value: "create-issue",
      hint: "Create a new GitHub issue",
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
            onMessage={setMessage}
            onBack={() => setSubScreen("menu")}
          />
        );
      case "run-checks":
        return (
          <RunChecksScreen
            projectPath={projectPath}
            onMessage={setMessage}
            onBack={() => setSubScreen("menu")}
          />
        );
      case "git-operations":
        return (
          <GitOperationsScreen
            projectPath={projectPath}
            onMessage={setMessage}
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
      {loading ? <Spinner message="Processing..." /> : renderSubScreen()}
      <Box marginTop={1}>
        <Text color="gray">Esc to go back</Text>
      </Box>
    </Box>
  );
}

interface SubScreenProps {
  onMessage: (msg: { type: "success" | "error" | "info"; text: string }) => void;
  onBack: () => void;
}

function InvokeDroidScreen({
  config,
  onMessage,
  onBack,
}: SubScreenProps & { config: OrcaConfig }) {
  const [step, setStep] = useState<"select-droid" | "enter-prompt" | "running">(
    "select-droid"
  );
  const [selectedDroid, setSelectedDroid] = useState<string>("");
  const [prompt, setPrompt] = useState<string>("");

  const droids = [
    "senior-backend-engineer",
    "frontend-developer",
    "fullstack-developer",
    "implementation-reviewer",
    "code-reviewer",
    "uat-runner",
    "qa-engineer",
    "technical-analyst",
    "troubleshooting-analyst",
    "documentation-specialist",
    "git-operator",
  ];

  if (step === "select-droid") {
    return (
      <Box flexDirection="column">
        <Text bold>Select Droid</Text>
        <QuestionPrompt
          question="Which droid do you want to invoke?"
          type="select"
          options={droids}
          onAnswer={(answer) => {
            setSelectedDroid(answer);
            setStep("enter-prompt");
          }}
          onCancel={onBack}
        />
      </Box>
    );
  }

  if (step === "enter-prompt") {
    return (
      <Box flexDirection="column">
        <Text bold>Invoke: {selectedDroid}</Text>
        <QuestionPrompt
          question="Enter your prompt for the droid:"
          type="text"
          onAnswer={(answer) => {
            setPrompt(answer);
            setStep("running");
            // TODO: Actually invoke the droid
            setTimeout(() => {
              onMessage({ type: "success", text: `Droid ${selectedDroid} invoked` });
              onBack();
            }, 2000);
          }}
          onCancel={onBack}
        />
      </Box>
    );
  }

  return <Spinner message={`Running ${selectedDroid}...`} />;
}

function RunChecksScreen({
  projectPath,
  onMessage,
  onBack,
}: SubScreenProps & { projectPath: string }) {
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
        onSelect={(value) => {
          if (value === "back") {
            onBack();
          } else {
            // TODO: Actually run the checks
            onMessage({ type: "info", text: `Running ${value}...` });
          }
        }}
      />
    </Box>
  );
}

function GitOperationsScreen({
  projectPath,
  onMessage,
  onBack,
}: SubScreenProps & { projectPath: string }) {
  const menuItems: MenuItem[] = [
    { label: "Create Stacked Branch", value: "create-branch" },
    { label: "Rebase Stack", value: "rebase" },
    { label: "Push Current Branch", value: "push" },
    { label: "View Stack", value: "view-stack" },
    { label: "Back", value: "back" },
  ];

  return (
    <Box flexDirection="column">
      <Text bold>Git Operations</Text>
      <Menu
        items={menuItems}
        onSelect={(value) => {
          if (value === "back") {
            onBack();
          } else {
            // TODO: Actually run git operations
            onMessage({ type: "info", text: `Running ${value}...` });
          }
        }}
      />
    </Box>
  );
}
