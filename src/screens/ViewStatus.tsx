import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { join } from "path";
import { Menu, type MenuItem } from "../components/Menu.js";
import { Spinner } from "../components/Spinner.js";
import { deriveSprintStatus } from "../lib/state.js";
import type { OrcaConfig, SprintStatus, Shard } from "../lib/types.js";

interface ViewStatusProps {
  config: OrcaConfig;
  projectPath: string;
  sprintStatus: SprintStatus | null;
  onBack: () => void;
  onEditShard?: (shard: Shard) => void;
}

type SubScreen = "select-project" | "menu" | "board" | "issues" | "droids" | "shards";

export function ViewStatus({
  config,
  projectPath,
  sprintStatus: initialSprintStatus,
  onBack,
  onEditShard,
}: ViewStatusProps) {
  const [subScreen, setSubScreen] = useState<SubScreen>(initialSprintStatus ? "menu" : "select-project");
  const [sprintStatus, setSprintStatus] = useState<SprintStatus | null>(initialSprintStatus);
  const [existingProjects, setExistingProjects] = useState<string[]>([]);
  const [selectedProjectPath, setSelectedProjectPath] = useState<string>(projectPath);
  const [loading, setLoading] = useState(false);

  // Load existing projects from workspace
  useEffect(() => {
    const loadProjects = async () => {
      const projectsDir = config.workspace_root 
        ? join(config.workspace_root, "projects")
        : join(projectPath, "projects");
      
      try {
        const { readdir, stat } = await import("fs/promises");
        const entries = await readdir(projectsDir);
        const dirs: string[] = [];
        
        for (const entry of entries) {
          const fullPath = join(projectsDir, entry);
          const stats = await stat(fullPath).catch(() => null);
          if (stats?.isDirectory() && !entry.startsWith(".")) {
            dirs.push(entry);
          }
        }
        
        setExistingProjects(dirs);
      } catch {
        setExistingProjects([]);
      }
    };
    
    loadProjects();
  }, [config.workspace_root, projectPath]);

  useInput((input, key) => {
    if (key.escape) {
      if (subScreen === "menu" || subScreen === "select-project") {
        onBack();
      } else {
        setSubScreen("menu");
      }
    }
  });

  const loadProjectStatus = async (path: string) => {
    setLoading(true);
    setSelectedProjectPath(path);
    const status = await deriveSprintStatus(path, config);
    setSprintStatus(status);
    setLoading(false);
    setSubScreen(status ? "menu" : "menu"); // Go to menu even if no status
  };

  const projectsDir = config.workspace_root 
    ? join(config.workspace_root, "projects")
    : join(projectPath, "projects");

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
    if (loading) {
      return <Spinner message="Loading project status..." />;
    }

    switch (subScreen) {
      case "select-project":
        const projectMenuItems: MenuItem[] = [
          ...existingProjects.map(p => ({
            label: p,
            value: `project:${p}`,
            hint: "existing project",
          })),
          {
            label: "Use Current Directory",
            value: "current",
            hint: projectPath,
          },
          {
            label: "Back",
            value: "back",
          },
        ];

        return (
          <Box flexDirection="column">
            <Text bold color="cyan">Select Project to View</Text>
            <Text color="gray" dimColor>Projects folder: {projectsDir}</Text>
            {existingProjects.length === 0 && (
              <Text color="yellow" dimColor>No existing projects found</Text>
            )}
            <Box marginTop={1}>
              <Menu 
                items={projectMenuItems} 
                onSelect={(value) => {
                  if (value === "back") {
                    onBack();
                  } else if (value === "current") {
                    loadProjectStatus(projectPath);
                  } else if (value.startsWith("project:")) {
                    const projectName = value.replace("project:", "");
                    loadProjectStatus(join(projectsDir, projectName));
                  }
                }}
                onCancel={onBack}
              />
            </Box>
          </Box>
        );
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
          <Box flexDirection="column">
            {sprintStatus && (
              <Text color="green" dimColor>Project: {selectedProjectPath.split("/").pop()}</Text>
            )}
            <Menu
              items={menuItems}
              onSelect={(value) => {
                if (value === "back") {
                  onBack();
                } else {
                  setSubScreen(value as SubScreen);
                }
              }}
              onCancel={onBack}
              title="View Status"
            />
          </Box>
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
