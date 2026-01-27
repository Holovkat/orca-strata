import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Menu, type MenuItem } from "../components/Menu.js";
import type { OrcaConfig, SprintStatus, Shard } from "../lib/types.js";

interface ViewStatusProps {
  config: OrcaConfig;
  projectPath: string;
  sprintStatus: SprintStatus | null;
  onBack: () => void;
  onEditShard?: (shard: Shard) => void;
}

type SubScreen = "menu" | "board" | "issues" | "droids" | "shards";

export function ViewStatus({
  config,
  projectPath,
  sprintStatus,
  onBack,
  onEditShard,
}: ViewStatusProps) {
  const [subScreen, setSubScreen] = useState<SubScreen>("menu");

  useInput((input, key) => {
    if (key.escape) {
      if (subScreen === "menu") {
        onBack();
      } else {
        setSubScreen("menu");
      }
    }
  });

  const menuItems: MenuItem[] = [
    {
      label: "View Board",
      value: "board",
      hint: "Kanban board view",
    },
    {
      label: "View Issues",
      value: "issues",
      hint: "GitHub issues list",
    },
    {
      label: "View Active Droids",
      value: "droids",
      hint: sprintStatus
        ? `${sprintStatus.activeDroids.length} running`
        : "None",
    },
    {
      label: "Edit Shards",
      value: "shards",
      hint: sprintStatus
        ? `${sprintStatus.sprint.shards.length} total`
        : "No sprint",
    },
    {
      label: "Back",
      value: "back",
    },
  ];

  const renderSubScreen = () => {
    switch (subScreen) {
      case "board":
        return <BoardView sprintStatus={sprintStatus} />;
      case "issues":
        return <IssuesView sprintStatus={sprintStatus} />;
      case "droids":
        return <DroidsView sprintStatus={sprintStatus} />;
      case "shards":
        return (
          <ShardsView
            sprintStatus={sprintStatus}
            onEditShard={onEditShard}
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
            title="View Status"
          />
        );
    }
  };

  return (
    <Box flexDirection="column">
      {renderSubScreen()}
      <Box marginTop={1}>
        <Text color="gray">Esc to go back</Text>
      </Box>
    </Box>
  );
}

function BoardView({ sprintStatus }: { sprintStatus: SprintStatus | null }) {
  if (!sprintStatus) {
    return <Text color="gray">No active sprint</Text>;
  }

  const columns = [
    { name: "Ready to Build", count: sprintStatus.counts.readyToBuild, color: "blue" },
    { name: "In Progress", count: sprintStatus.counts.inProgress, color: "yellow" },
    { name: "Ready for Review", count: sprintStatus.counts.readyForReview, color: "cyan" },
    { name: "In Review", count: sprintStatus.counts.inReview, color: "cyan" },
    { name: "Ready for UAT", count: sprintStatus.counts.readyForUat, color: "magenta" },
    { name: "UAT in Progress", count: sprintStatus.counts.uatInProgress, color: "magenta" },
    { name: "User Acceptance", count: sprintStatus.counts.userAcceptance, color: "white" },
    { name: "Done", count: sprintStatus.counts.done, color: "green" },
  ];

  return (
    <Box flexDirection="column">
      <Text bold>Kanban Board: {sprintStatus.sprint.name}</Text>
      <Box marginY={1} flexDirection="column">
        {columns.map((col) => (
          <Box key={col.name} gap={1}>
            <Box width={20}>
              <Text color={col.color as any}>{col.name}</Text>
            </Box>
            <Text color={col.color as any}>{"█".repeat(col.count)}</Text>
            <Text color="gray"> {col.count}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function IssuesView({ sprintStatus }: { sprintStatus: SprintStatus | null }) {
  if (!sprintStatus) {
    return <Text color="gray">No active sprint</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text bold>GitHub Issues</Text>
      <Box marginY={1} flexDirection="column">
        {sprintStatus.sprint.shards.map((shard) => (
          <Box key={shard.id} gap={1}>
            <Text color="cyan">#{shard.issueNumber || "?"}</Text>
            <Text>{shard.title}</Text>
            <Text color="gray">[{shard.status}]</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function DroidsView({ sprintStatus }: { sprintStatus: SprintStatus | null }) {
  if (!sprintStatus || sprintStatus.activeDroids.length === 0) {
    return <Text color="gray">No active droids</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text bold>Active Droids</Text>
      <Box marginY={1} flexDirection="column">
        {sprintStatus.activeDroids.map((droid) => (
          <Box key={droid.shardId} gap={1}>
            <Text color="yellow">⠋</Text>
            <Text>{droid.droid}</Text>
            <Text color="gray">→ {droid.shardId}</Text>
            <Text color="cyan">
              {Math.round((Date.now() - droid.startedAt.getTime()) / 1000)}s
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

interface ShardsViewProps {
  sprintStatus: SprintStatus | null;
  onEditShard?: (shard: Shard) => void;
}

function ShardsView({ sprintStatus, onEditShard }: ShardsViewProps) {
  if (!sprintStatus) {
    return <Text color="gray">No active sprint</Text>;
  }

  const statusColors: Record<string, string> = {
    "Ready to Build": "blue",
    "In Progress": "yellow",
    "Ready for Review": "cyan",
    "In Review": "cyan",
    "Ready for UAT": "magenta",
    "UAT in Progress": "magenta",
    "User Acceptance": "white",
    "Done": "green",
  };

  // Convert shards to menu items
  const shardItems: MenuItem[] = sprintStatus.sprint.shards.map((shard) => ({
    label: `${shard.title}`,
    value: shard.id,
    hint: `[${shard.type}] ${shard.status}`,
  }));

  shardItems.push({ label: "Back to Menu", value: "__back__" });

  return (
    <Box flexDirection="column">
      <Text bold>Shards - Click/Enter to Edit</Text>
      <Text color="gray" dimColor>Editing a shard will reset its status if content changes</Text>
      <Box marginY={1}>
        <Menu
          items={shardItems}
          onSelect={(value) => {
            if (value === "__back__") {
              return;
            }
            const shard = sprintStatus.sprint.shards.find(s => s.id === value);
            if (shard && onEditShard) {
              onEditShard(shard);
            }
          }}
        />
      </Box>
    </Box>
  );
}
