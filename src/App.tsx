import React, { useState, useEffect, useCallback } from "react";
import { Box } from "ink";
import { MainMenu } from "./screens/MainMenu.js";
import { NewSprint } from "./screens/NewSprint.js";
import { ContinueSprint } from "./screens/ContinueSprint.js";
import { ViewStatus } from "./screens/ViewStatus.js";
import { ManualActions } from "./screens/ManualActions.js";
import { Settings } from "./screens/Settings.js";
import { ShardEditor } from "./screens/ShardEditor.js";
import { DroidChat } from "./screens/DroidChat.js";
import { DroidViewer } from "./screens/DroidViewer.js";
import { Header } from "./components/Header.js";
import { Spinner } from "./components/Spinner.js";
import { ProjectSelector } from "./components/ProjectSelector.js";
import { deriveSprintStatus, refreshStatus } from "./lib/state.js";
import { saveConfig } from "./lib/config.js";
import type { OrcaConfig, Screen, SprintStatus, Shard, SprintStatusCounts, RunningDroid } from "./lib/types.js";

// Calculate counts from shards list
function calculateCounts(shards: Shard[]): SprintStatusCounts {
  return {
    total: shards.length,
    readyToBuild: shards.filter(s => s.status === "Ready to Build").length,
    inProgress: shards.filter(s => s.status === "In Progress").length,
    readyForReview: shards.filter(s => s.status === "Ready for Review").length,
    inReview: shards.filter(s => s.status === "In Review").length,
    readyForUat: shards.filter(s => s.status === "Ready for UAT").length,
    uatInProgress: shards.filter(s => s.status === "UAT in Progress").length,
    userAcceptance: shards.filter(s => s.status === "User Acceptance").length,
    done: shards.filter(s => s.status === "Done").length,
  };
}

interface AppProps {
  config: OrcaConfig;
  projectPath: string;
  configFile: string;
}

export function App({ config, projectPath, configFile }: AppProps) {
  const [screen, setScreen] = useState<Screen>("select-project");
  const [sprintStatus, setSprintStatus] = useState<SprintStatus | null>(null);
  const [currentConfig, setCurrentConfig] = useState(config);
  const [currentProjectPath, setCurrentProjectPath] = useState(projectPath);
  const [currentProjectName, setCurrentProjectName] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [selectedShard, setSelectedShard] = useState<Shard | null>(null);
  const [chatPrompt, setChatPrompt] = useState<string | undefined>(undefined);
  
  // Track running droids with their output buffers
  const [runningDroids, setRunningDroids] = useState<RunningDroid[]>([]);
  const [viewingDroidId, setViewingDroidId] = useState<string | undefined>(undefined);

  // Add a new running droid
  const addRunningDroid = useCallback((droid: RunningDroid) => {
    setRunningDroids(prev => [...prev, droid]);
  }, []);

  // Update a running droid's output
  const appendDroidOutput = useCallback((shardId: string, chunk: string) => {
    setRunningDroids(prev => prev.map(d => 
      d.shardId === shardId 
        ? { ...d, output: d.output + chunk }
        : d
    ));
  }, []);

  // Update a running droid's status
  const updateDroidStatus = useCallback((shardId: string, status: "running" | "complete" | "failed", exitCode?: number) => {
    setRunningDroids(prev => prev.map(d => 
      d.shardId === shardId 
        ? { ...d, status, completedAt: status !== "running" ? new Date() : undefined, exitCode }
        : d
    ));
  }, []);

  // Remove completed droids (cleanup)
  const clearCompletedDroids = useCallback(() => {
    setRunningDroids(prev => prev.filter(d => d.status === "running"));
  }, []);

  // View a specific droid's output
  const viewDroid = useCallback((shardId: string) => {
    setViewingDroidId(shardId);
    setScreen("droid-viewer");
  }, []);

  // Load project state when project is selected
  const loadProjectState = useCallback(async (path: string) => {
    setLoading(true);
    const status = await deriveSprintStatus(path, currentConfig);
    setSprintStatus(status);
    setLoading(false);
  }, [currentConfig]);

  // Handle project selection
  const handleProjectSelected = useCallback(async (path: string, name: string) => {
    if (path === "__new__") {
      // Go to new sprint to create a new project
      setScreen("new-sprint");
      return;
    }
    
    setCurrentProjectPath(path);
    setCurrentProjectName(name);
    await loadProjectState(path);
    setScreen("main");
  }, [loadProjectState]);

  // Handle config changes - save to file
  const handleConfigChange = useCallback(async (newConfig: OrcaConfig) => {
    setCurrentConfig(newConfig);
    try {
      await saveConfig(currentProjectPath, configFile, newConfig);
    } catch (err) {
      // Config save failed, but we still update in-memory
      console.error("Failed to save config:", err);
    }
  }, [currentProjectPath, configFile]);

  // Handle project path change (when creating new project in NewSprint)
  const handleProjectPathChange = useCallback(async (newPath: string) => {
    setCurrentProjectPath(newPath);
    setCurrentProjectName(newPath.split("/").pop() || "project");
    await loadProjectState(newPath);
  }, [loadProjectState]);

  // Handle sprint status changes (runtime only - active droids, etc.)
  const handleSprintStatusChange = useCallback((status: SprintStatus | null) => {
    setSprintStatus(status);
  }, []);

  // Handle new sprint creation
  const handleSprintCreated = useCallback((status: SprintStatus) => {
    setSprintStatus(status);
    // Update project name from path if not set
    if (!currentProjectName) {
      setCurrentProjectName(currentProjectPath.split("/").pop() || "project");
    }
    setScreen("continue-sprint");
  }, [currentProjectName, currentProjectPath]);

  // Handle shard selection for editing
  const handleEditShard = useCallback((shard: Shard) => {
    setSelectedShard(shard);
    setScreen("shard-editor");
  }, []);

  // Handle starting a droid chat for a shard
  const handleStartChat = useCallback((shard: Shard, prompt?: string) => {
    setSelectedShard(shard);
    setChatPrompt(prompt);
    setScreen("droid-chat");
  }, []);

  // Handle starting a droid chat without a shard (from manual actions)
  const handleStartChatManual = useCallback((prompt: string) => {
    setSelectedShard(null);
    setChatPrompt(prompt);
    setScreen("droid-chat");
  }, []);

  // Handle shard update
  const handleShardUpdated = useCallback((updatedShard: Shard) => {
    if (sprintStatus) {
      const updatedShards = sprintStatus.sprint.shards.map(s =>
        s.id === updatedShard.id ? updatedShard : s
      );
      // Recalculate counts
      const counts = calculateCounts(updatedShards);
      setSprintStatus({
        ...sprintStatus,
        sprint: {
          ...sprintStatus.sprint,
          shards: updatedShards,
        },
        counts,
      });
    }
  }, [sprintStatus]);

  // Handle shard deprecation - remove from sprint
  const handleShardDeprecated = useCallback((shardId: string) => {
    if (sprintStatus) {
      const updatedShards = sprintStatus.sprint.shards.filter(s => s.id !== shardId);
      // Recalculate counts
      const counts = calculateCounts(updatedShards);
      setSprintStatus({
        ...sprintStatus,
        sprint: {
          ...sprintStatus.sprint,
          shards: updatedShards,
        },
        counts,
      });
      setSelectedShard(null);
    }
  }, [sprintStatus]);

  // Refresh status from sources of truth
  const handleRefresh = useCallback(async () => {
    if (sprintStatus) {
      setLoading(true);
      const refreshed = await refreshStatus(currentProjectPath, currentConfig, sprintStatus);
      setSprintStatus(refreshed);
      setLoading(false);
    }
  }, [currentProjectPath, currentConfig, sprintStatus]);

  if (loading) {
    return (
      <Box flexDirection="column" padding={1}>
        <Spinner message="Loading project state from GitHub/checklists..." />
      </Box>
    );
  }

  const renderScreen = () => {
    switch (screen) {
      case "select-project":
        return (
          <ProjectSelector
            config={currentConfig}
            initialProjectPath={currentProjectPath}
            onProjectSelected={handleProjectSelected}
          />
        );
      case "main":
        return (
          <MainMenu
            onSelect={setScreen}
            sprintStatus={sprintStatus}
          />
        );
      case "new-sprint":
        return (
          <NewSprint
            config={currentConfig}
            projectPath={currentProjectPath}
            onBack={() => setScreen("main")}
            onSprintCreated={handleSprintCreated}
            onProjectPathChange={handleProjectPathChange}
          />
        );
      case "continue-sprint":
        return (
          <ContinueSprint
            config={currentConfig}
            projectPath={currentProjectPath}
            sprintStatus={sprintStatus}
            onBack={() => setScreen("main")}
            onStatusChange={handleSprintStatusChange}
            onStartChat={handleStartChat}
            runningDroids={runningDroids}
            onAddRunningDroid={addRunningDroid}
            onAppendDroidOutput={appendDroidOutput}
            onUpdateDroidStatus={updateDroidStatus}
            onViewDroid={viewDroid}
          />
        );
      case "view-status":
        return (
          <ViewStatus
            config={currentConfig}
            projectPath={currentProjectPath}
            sprintStatus={sprintStatus}
            onBack={() => setScreen("main")}
            onEditShard={handleEditShard}
            onProjectPathChange={handleProjectPathChange}
          />
        );
      case "shard-editor":
        if (selectedShard) {
          return (
            <ShardEditor
              config={currentConfig}
              projectPath={currentProjectPath}
              shard={selectedShard}
              onBack={() => setScreen("view-status")}
              onShardUpdated={handleShardUpdated}
              onShardDeprecated={handleShardDeprecated}
            />
          );
        }
        return <MainMenu onSelect={setScreen} sprintStatus={sprintStatus} />;
      case "droid-chat":
        return (
          <DroidChat
            config={currentConfig}
            projectPath={currentProjectPath}
            shard={selectedShard || undefined}
            initialPrompt={chatPrompt}
            onBack={() => {
              setChatPrompt(undefined);
              setScreen(selectedShard ? "continue-sprint" : "main");
            }}
            onComplete={(success) => {
              // Could update shard status here if needed
            }}
          />
        );
      case "manual-actions":
        return (
          <ManualActions
            config={currentConfig}
            projectPath={currentProjectPath}
            onBack={() => setScreen("main")}
            onStartChat={handleStartChatManual}
          />
        );
      case "settings":
        return (
          <Settings
            config={currentConfig}
            onBack={() => setScreen("main")}
            onConfigChange={handleConfigChange}
          />
        );
      case "droid-viewer":
        return (
          <DroidViewer
            runningDroids={runningDroids}
            selectedDroidId={viewingDroidId}
            onBack={() => {
              setViewingDroidId(undefined);
              setScreen("continue-sprint");
            }}
            onSelectDroid={setViewingDroidId}
          />
        );
      default:
        return <MainMenu onSelect={setScreen} sprintStatus={sprintStatus} />;
    }
  };

  // Project selector has its own header, so skip the main header
  if (screen === "select-project") {
    return renderScreen();
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Header
        projectName={currentProjectName || currentConfig.project_name || currentProjectPath.split("/").pop() || "Unnamed Project"}
        sprintStatus={sprintStatus}
      />
      {renderScreen()}
    </Box>
  );
}
