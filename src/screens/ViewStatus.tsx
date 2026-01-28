import React, { useState, useEffect } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { join } from "path";
import { Menu, type MenuItem } from "../components/Menu.js";
import { Spinner } from "../components/Spinner.js";
import { deriveSprintStatus } from "../lib/state.js";
import { getAllModels, type CustomModel } from "../lib/models.js";
import type { OrcaConfig, SprintStatus, Shard } from "../lib/types.js";

interface ViewStatusProps {
  config: OrcaConfig;
  projectPath: string;
  sprintStatus: SprintStatus | null;
  onBack: () => void;
  onEditShard?: (shard: Shard) => void;
  onProjectPathChange?: (newPath: string) => void;
  onUpdateShardModel?: (shardId: string | string[], model: string | undefined) => void;
}

type SubScreen = "select-project" | "menu" | "board" | "issues" | "droids" | "shards";

export function ViewStatus({
  config,
  projectPath,
  sprintStatus: initialSprintStatus,
  onBack,
  onEditShard,
  onProjectPathChange,
  onUpdateShardModel,
}: ViewStatusProps) {
  const [subScreen, setSubScreen] = useState<SubScreen>(initialSprintStatus ? "menu" : "select-project");
  const [sprintStatus, setSprintStatus] = useState<SprintStatus | null>(initialSprintStatus);
  const [existingProjects, setExistingProjects] = useState<string[]>([]);
  const [selectedProjectPath, setSelectedProjectPath] = useState<string>(projectPath);
  const [loading, setLoading] = useState(false);

  // Sync local state when props change (e.g., after model update)
  useEffect(() => {
    setSprintStatus(initialSprintStatus);
  }, [initialSprintStatus]);

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
    onProjectPathChange?.(path); // Update App's project path
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
            onUpdateShardModel={onUpdateShardModel}
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
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || 24;
  const terminalWidth = stdout?.columns || 80;
  
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
  
  // Scale bars to fit terminal width
  const maxBarWidth = Math.max(10, terminalWidth - 30);
  const maxCount = Math.max(...columns.map(c => c.count), 1);

  return (
    <Box flexDirection="column" height={terminalHeight - 4}>
      <Text bold>Kanban Board: {sprintStatus.sprint.name}</Text>
      <Box marginY={1} flexDirection="column" flexGrow={1} overflow="hidden">
        {columns.map((col) => {
          const barWidth = Math.round((col.count / maxCount) * Math.min(maxCount, maxBarWidth));
          return (
            <Box key={col.name} gap={1}>
              <Box width={18}>
                <Text color={col.color as any}>{col.name}</Text>
              </Box>
              <Text color={col.color as any}>{"█".repeat(barWidth)}</Text>
              <Text color="gray"> {col.count}</Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function IssuesView({ sprintStatus }: { sprintStatus: SprintStatus | null }) {
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || 24;
  const terminalWidth = stdout?.columns || 80;
  const maxItems = Math.max(5, terminalHeight - 6);
  
  if (!sprintStatus) {
    return <Text color="gray">No active sprint</Text>;
  }
  
  const truncate = (text: string, max: number) => 
    text.length <= max ? text : text.slice(0, max - 3) + "...";

  return (
    <Box flexDirection="column" height={terminalHeight - 4}>
      <Text bold>GitHub Issues ({sprintStatus.sprint.shards.length})</Text>
      <Box marginY={1} flexDirection="column" flexGrow={1} overflow="hidden">
        {sprintStatus.sprint.shards.slice(0, maxItems).map((shard) => (
          <Box key={shard.id} gap={1}>
            <Text color="cyan">#{shard.issueNumber || "?"}</Text>
            <Text wrap="truncate-end">{truncate(shard.title, terminalWidth - 25)}</Text>
            <Text color="gray">[{shard.status}]</Text>
          </Box>
        ))}
        {sprintStatus.sprint.shards.length > maxItems && (
          <Text color="gray" dimColor>+{sprintStatus.sprint.shards.length - maxItems} more...</Text>
        )}
      </Box>
    </Box>
  );
}

function DroidsView({ sprintStatus }: { sprintStatus: SprintStatus | null }) {
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || 24;
  
  if (!sprintStatus || sprintStatus.activeDroids.length === 0) {
    return <Text color="gray">No active droids</Text>;
  }

  return (
    <Box flexDirection="column" height={terminalHeight - 4}>
      <Text bold>Active Droids ({sprintStatus.activeDroids.length})</Text>
      <Box marginY={1} flexDirection="column" flexGrow={1} overflow="hidden">
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
  onUpdateShardModel?: (shardId: string | string[], model: string | undefined) => void;
}

function ShardsView({ sprintStatus, onEditShard, onUpdateShardModel }: ShardsViewProps) {
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || 24;
  const terminalWidth = stdout?.columns || 80;
  const [selectingModelFor, setSelectingModelFor] = useState<string | null>(null);
  const [models, setModels] = useState<CustomModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [selectedShards, setSelectedShards] = useState<Set<string>>(new Set());
  const [batchModelSelect, setBatchModelSelect] = useState(false);
  
  // Load models when entering model selection
  useEffect(() => {
    if (selectingModelFor || batchModelSelect) {
      setLoadingModels(true);
      getAllModels().then((m) => {
        setModels(m);
        setLoadingModels(false);
      });
    }
  }, [selectingModelFor, batchModelSelect]);
  
  if (!sprintStatus) {
    return <Text color="gray">No active sprint</Text>;
  }

  const truncate = (text: string, max: number) => 
    text.length <= max ? text : text.slice(0, max - 3) + "...";

  // Format model name for display (short form for list)
  const formatModelShort = (model: string | undefined): string => {
    if (!model) return "";
    if (model.includes("sonnet-4-5")) return "sonnet-4.5";
    if (model.includes("sonnet-4")) return "sonnet-4";
    if (model.includes("opus-4")) return "opus-4";
    if (model.includes("haiku")) return "haiku";
    if (model.startsWith("custom:")) return model.replace("custom:", "").slice(0, 10);
    return model.slice(0, 12);
  };

  // Toggle shard selection
  const toggleShardSelection = (shardId: string) => {
    if (shardId === "__back__") return;
    setSelectedShards(prev => {
      const next = new Set(prev);
      if (next.has(shardId)) {
        next.delete(shardId);
      } else {
        next.add(shardId);
      }
      return next;
    });
  };

  // Handle 'm' key - either single shard or batch
  const handleModelKey = (selectedValue: string) => {
    if (selectedValue === "__back__") return;
    
    if (selectedShards.size > 0) {
      // Batch mode - apply to all selected shards
      setBatchModelSelect(true);
    } else {
      // Single shard mode
      setSelectingModelFor(selectedValue);
    }
  };

  // Handle 'a' key - select/deselect all shards
  const handleSelectAllKey = () => {
    if (selectedShards.size === sprintStatus.sprint.shards.length) {
      // All selected, deselect all
      setSelectedShards(new Set());
    } else {
      // Select all shards
      setSelectedShards(new Set(sprintStatus.sprint.shards.map(s => s.id)));
    }
  };

  // Apply model to shards (single or batch)
  const applyModel = (model: string | undefined) => {
    if (batchModelSelect) {
      // Apply to all selected shards at once
      const shardIds = Array.from(selectedShards);
      onUpdateShardModel?.(shardIds, model);
      setSelectedShards(new Set());
      setBatchModelSelect(false);
    } else if (selectingModelFor) {
      // Apply to single shard
      onUpdateShardModel?.(selectingModelFor, model);
      setSelectingModelFor(null);
    }
  };

  // Model selection sub-menu (for single or batch)
  if (selectingModelFor || batchModelSelect) {
    if (loadingModels) {
      return <Spinner message="Loading models from Factory settings..." />;
    }

    const targetShards = batchModelSelect 
      ? Array.from(selectedShards).map(id => sprintStatus.sprint.shards.find(s => s.id === id)).filter(Boolean)
      : [sprintStatus.sprint.shards.find(s => s.id === selectingModelFor)].filter(Boolean);
    
    // Group models by type
    const builtinModels = models.filter(m => !m.id.startsWith("custom:"));
    const customModels = models.filter(m => m.id.startsWith("custom:"));

    const modelOptions: MenuItem[] = [
      { label: "Use Default", value: "__default__", hint: "inherit from config" },
      { label: "─── Builtin Models ───", value: "__divider1__", disabled: true },
      ...builtinModels.map(m => ({
        label: m.displayName,
        value: m.id,
        hint: "builtin",
      })),
      ...(customModels.length > 0 ? [
        { label: "─── Custom Models ───", value: "__divider2__", disabled: true },
        ...customModels.map(m => ({
          label: m.displayName,
          value: m.id,
          hint: "custom",
        })),
      ] : []),
      { label: "───────────", value: "__divider3__", disabled: true },
      { label: "← Cancel", value: "__cancel__" },
    ];

    const title = batchModelSelect 
      ? `Set Model for ${selectedShards.size} selected shards`
      : `Set Model for: ${targetShards[0]?.title || selectingModelFor}`;

    return (
      <Box flexDirection="column" height={terminalHeight - 4}>
        <Text bold>{title}</Text>
        <Text color="gray" dimColor>
          {models.length} models available ({builtinModels.length} builtin, {customModels.length} custom)
        </Text>
        <Box marginY={1} flexGrow={1} overflow="hidden">
          <Menu
            items={modelOptions}
            onSelect={(value) => {
              if (value === "__cancel__") {
                setSelectingModelFor(null);
                setBatchModelSelect(false);
              } else if (value === "__default__") {
                applyModel(undefined);
              } else if (!value.startsWith("__")) {
                applyModel(value);
              }
            }}
            onCancel={() => {
              setSelectingModelFor(null);
              setBatchModelSelect(false);
            }}
          />
        </Box>
      </Box>
    );
  }

  // Convert shards to menu items with model display in requested format:
  // shardname - [modelname] - [frontend] - Ready to Build
  const shardItems: MenuItem[] = sprintStatus.sprint.shards.map((shard) => {
    const modelDisplay = shard.model ? `[${formatModelShort(shard.model)}]` : "";
    const typeDisplay = `[${shard.type}]`;
    const statusDisplay = shard.status;
    
    // Calculate available space for title
    const fixedParts = ` - ${modelDisplay} - ${typeDisplay} - ${statusDisplay}`.length;
    const availableForTitle = terminalWidth - fixedParts - 10; // 10 for checkbox and cursor
    const title = truncate(shard.title, Math.max(20, availableForTitle));
    
    // Build the label: title - [model] - [type] - status
    const parts = [title];
    if (modelDisplay) parts.push(modelDisplay);
    parts.push(typeDisplay);
    parts.push(statusDisplay);
    
    return {
      label: parts.join(" - "),
      value: shard.id,
    };
  });

  shardItems.push({ label: "Back to Menu", value: "__back__" });

  const selectionHint = selectedShards.size > 0 
    ? `${selectedShards.size} selected` 
    : "";

  return (
    <Box flexDirection="column" height={terminalHeight - 4}>
      <Text bold>Shards - Click/Enter to Edit ({sprintStatus.sprint.shards.length})</Text>
      <Text color="gray" dimColor>
        Space to select, a select all, m set model
        {selectionHint && <Text color="green"> | {selectionHint}</Text>}
      </Text>
      <Box marginY={1} flexGrow={1} overflow="hidden">
        <Menu
          items={shardItems}
          multiSelect={true}
          selectedValues={selectedShards}
          onToggleSelect={toggleShardSelection}
          onSelect={(value) => {
            if (value === "__back__") {
              return;
            }
            const shard = sprintStatus.sprint.shards.find(s => s.id === value);
            if (shard && onEditShard) {
              onEditShard(shard);
            }
          }}
          onKeyPress={(key, selectedValue) => {
            if (key === "m") {
              handleModelKey(selectedValue);
            } else if (key === "a") {
              handleSelectAllKey();
            }
          }}
          extraHints="a All | m Model"
        />
      </Box>
    </Box>
  );
}
