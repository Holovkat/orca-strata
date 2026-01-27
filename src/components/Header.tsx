import React from "react";
import { Box, Text } from "ink";
import type { SprintStatus } from "../lib/types.js";

interface HeaderProps {
  projectName: string;
  sprintStatus: SprintStatus | null;
}

export function Header({ projectName, sprintStatus }: HeaderProps) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box borderStyle="double" borderColor="cyan" paddingX={2}>
        <Text bold color="cyan">
          ORCA
        </Text>
        <Text> - </Text>
        <Text>{projectName}</Text>
        {sprintStatus && (
          <>
            <Text> | </Text>
            <Text color="yellow">{sprintStatus.sprint.name}</Text>
          </>
        )}
      </Box>
      {sprintStatus && (
        <Box marginTop={1} gap={2}>
          <StatusBadge
            label="Build"
            current={sprintStatus.counts.inProgress + sprintStatus.counts.readyToBuild}
            total={sprintStatus.counts.total}
            color="blue"
          />
          <StatusBadge
            label="Review"
            current={sprintStatus.counts.inReview + sprintStatus.counts.readyForReview}
            total={sprintStatus.counts.total}
            color="yellow"
          />
          <StatusBadge
            label="UAT"
            current={sprintStatus.counts.uatInProgress + sprintStatus.counts.readyForUat}
            total={sprintStatus.counts.total}
            color="magenta"
          />
          <StatusBadge
            label="Done"
            current={sprintStatus.counts.done}
            total={sprintStatus.counts.total}
            color="green"
          />
        </Box>
      )}
    </Box>
  );
}

interface StatusBadgeProps {
  label: string;
  current: number;
  total: number;
  color: string;
}

function StatusBadge({ label, current, total, color }: StatusBadgeProps) {
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
  const filled = Math.round(percentage / 10);
  const empty = 10 - filled;

  return (
    <Box>
      <Text color={color}>{label}: </Text>
      <Text color={color}>{"█".repeat(filled)}</Text>
      <Text color="gray">{"░".repeat(empty)}</Text>
      <Text> {current}/{total}</Text>
    </Box>
  );
}
