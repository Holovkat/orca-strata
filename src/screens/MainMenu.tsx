import React from "react";
import { Box, Text, useApp, useInput } from "ink";
import { Menu, type MenuItem } from "../components/Menu.js";
import type { Screen, SprintStatus } from "../lib/types.js";

interface MainMenuProps {
  onSelect: (screen: Screen) => void;
  sprintStatus: SprintStatus | null;
}

export function MainMenu({ onSelect, sprintStatus }: MainMenuProps) {
  const { exit } = useApp();

  useInput((input) => {
    if (input === "q") {
      exit();
    }
  });

  const menuItems: MenuItem[] = [
    {
      label: "Start New Sprint",
      value: "new-sprint",
      hint: "Plan and create a new sprint",
    },
    {
      label: "Continue Sprint",
      value: "continue-sprint",
      disabled: !sprintStatus,
      hint: sprintStatus
        ? `${sprintStatus.sprint.name} - ${sprintStatus.sprint.phase}`
        : "No active sprint",
    },
    {
      label: "View Status",
      value: "view-status",
      hint: "View boards, issues, and progress",
    },
    {
      label: "Manual Actions",
      value: "manual-actions",
      hint: "Invoke droids, manage issues, git ops",
    },
    {
      label: "Settings",
      value: "settings",
      hint: "Configure project settings",
    },
    {
      label: "Exit",
      value: "exit",
    },
  ];

  const handleSelect = (value: string) => {
    if (value === "exit") {
      exit();
    } else {
      onSelect(value as Screen);
    }
  };

  return (
    <Box flexDirection="column">
      <Menu
        items={menuItems}
        onSelect={handleSelect}
        title="Main Menu"
      />
    </Box>
  );
}
