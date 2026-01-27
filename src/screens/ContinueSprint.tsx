import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Menu, type MenuItem } from "../components/Menu.js";
import { Spinner } from "../components/Spinner.js";
import { StatusMessage } from "../components/StatusMessage.js";
import type { OrcaConfig, SprintStatus, Phase } from "../lib/types.js";

interface ContinueSprintProps {
  config: OrcaConfig;
  projectPath: string;
  sprintStatus: SprintStatus | null;
  onBack: () => void;
  onStatusChange: (status: SprintStatus) => void;
}

type SubScreen = "menu" | "build" | "review" | "uat" | "user-acceptance" | "deploy";

export function ContinueSprint({
  config,
  projectPath,
  sprintStatus,
  onBack,
  onStatusChange,
}: ContinueSprintProps) {
  const [subScreen, setSubScreen] = useState<SubScreen>("menu");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

  useInput((input, key) => {
    if (key.escape) {
      if (subScreen === "menu") {
        onBack();
      } else {
        setSubScreen("menu");
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
      hint: sprintStatus.counts.done === sprintStatus.counts.total
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
            sprintStatus={sprintStatus}
            onStatusChange={onStatusChange}
            onBack={() => setSubScreen("menu")}
          />
        );
      case "review":
        return (
          <ReviewPhase
            config={config}
            sprintStatus={sprintStatus}
            onStatusChange={onStatusChange}
            onBack={() => setSubScreen("menu")}
          />
        );
      case "uat":
        return (
          <UatPhase
            config={config}
            sprintStatus={sprintStatus}
            onStatusChange={onStatusChange}
            onBack={() => setSubScreen("menu")}
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
            sprintStatus={sprintStatus}
            onBack={() => setSubScreen("menu")}
          />
        );
      default:
        return (
          <Menu
            items={menuItems}
            onSelect={handleSelect}
            title="Continue Sprint"
          />
        );
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
      {loading ? <Spinner message="Processing..." /> : renderSubScreen()}
      <Box marginTop={1}>
        <Text color="gray">Esc to go back</Text>
      </Box>
    </Box>
  );
}

// Sub-phase components (placeholders for now)

interface PhaseProps {
  config?: OrcaConfig;
  sprintStatus: SprintStatus;
  onStatusChange?: (status: SprintStatus) => void;
  onBack: () => void;
}

function BuildPhase({ config, sprintStatus, onStatusChange, onBack }: PhaseProps) {
  const readyShards = sprintStatus.sprint.shards.filter(
    (s) => s.status === "Ready to Build"
  );

  const menuItems: MenuItem[] = [
    {
      label: "Start All Ready Shards",
      value: "start-all",
      hint: `${readyShards.length} shards ready`,
      disabled: readyShards.length === 0,
    },
    {
      label: "Start Single Shard",
      value: "start-one",
      disabled: readyShards.length === 0,
    },
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
      <Text bold color="blue">Build Phase</Text>
      <Box marginY={1}>
        <Text>Ready to build: {readyShards.length}</Text>
        <Text> | In progress: {sprintStatus.counts.inProgress}</Text>
      </Box>
      <Menu
        items={menuItems}
        onSelect={(value) => {
          if (value === "back") onBack();
          // TODO: Implement other actions
        }}
      />
    </Box>
  );
}

function ReviewPhase({ config, sprintStatus, onStatusChange, onBack }: PhaseProps) {
  const menuItems: MenuItem[] = [
    {
      label: "Run Implementation Review",
      value: "impl-review",
      hint: `${sprintStatus.counts.readyForReview} ready`,
    },
    {
      label: "Run Code Review",
      value: "code-review",
    },
    {
      label: "Run Lint & Build",
      value: "lint-build",
    },
    {
      label: "Back",
      value: "back",
    },
  ];

  return (
    <Box flexDirection="column">
      <Text bold color="yellow">Review Phase</Text>
      <Menu
        items={menuItems}
        onSelect={(value) => {
          if (value === "back") onBack();
          // TODO: Implement other actions
        }}
      />
    </Box>
  );
}

function UatPhase({ config, sprintStatus, onStatusChange, onBack }: PhaseProps) {
  const menuItems: MenuItem[] = [
    {
      label: "Run UAT Tests",
      value: "run-uat",
      hint: `${sprintStatus.counts.readyForUat} ready`,
    },
    {
      label: "View Results",
      value: "view-results",
    },
    {
      label: "Back",
      value: "back",
    },
  ];

  return (
    <Box flexDirection="column">
      <Text bold color="magenta">UAT Phase</Text>
      <Menu
        items={menuItems}
        onSelect={(value) => {
          if (value === "back") onBack();
          // TODO: Implement other actions
        }}
      />
    </Box>
  );
}

function UserAcceptancePhase({ sprintStatus, onStatusChange, onBack }: PhaseProps) {
  const menuItems: MenuItem[] = [
    {
      label: "Review Items",
      value: "review",
      hint: `${sprintStatus.counts.userAcceptance} awaiting`,
    },
    {
      label: "Approve All",
      value: "approve-all",
    },
    {
      label: "Back",
      value: "back",
    },
  ];

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">User Acceptance</Text>
      <Menu
        items={menuItems}
        onSelect={(value) => {
          if (value === "back") onBack();
          // TODO: Implement other actions
        }}
      />
    </Box>
  );
}

function DeployPhase({ config, sprintStatus, onBack }: PhaseProps) {
  const menuItems: MenuItem[] = [
    {
      label: "Rebase Stack",
      value: "rebase",
    },
    {
      label: "Push to Remote",
      value: "push",
    },
    {
      label: "Squash Merge",
      value: "merge",
    },
    {
      label: "Archive Board",
      value: "archive",
    },
    {
      label: "Back",
      value: "back",
    },
  ];

  return (
    <Box flexDirection="column">
      <Text bold color="green">Deploy Phase</Text>
      <Menu
        items={menuItems}
        onSelect={(value) => {
          if (value === "back") onBack();
          // TODO: Implement other actions
        }}
      />
    </Box>
  );
}
