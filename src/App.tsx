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
import { Header } from "./components/Header.js";
import { Spinner } from "./components/Spinner.js";
import { deriveSprintStatus, refreshStatus } from "./lib/state.js";
import { saveConfig } from "./lib/config.js";
import type { OrcaConfig, Screen, SprintStatus, Shard } from "./lib/types.js";

interface AppProps {
  config: OrcaConfig;
  projectPath: string;
  configFile: string;
}

export function App({ config, projectPath, configFile }: AppProps) {
  const [screen, setScreen] = useState<Screen>("main");
  const [sprintStatus, setSprintStatus] = useState<SprintStatus | null>(null);
  const [currentConfig, setCurrentConfig] = useState(config);
  const [currentProjectPath, setCurrentProjectPath] = useState(projectPath);
  const [loading, setLoading] = useState(true);
  const [selectedShard, setSelectedShard] = useState<Shard | null>(null);
  const [chatPrompt, setChatPrompt] = useState<string | undefined>(undefined);

  // Derive state from sources of truth on startup
  useEffect(() => {
    async function init() {
      const status = await deriveSprintStatus(currentProjectPath, currentConfig);
      setSprintStatus(status);
      setLoading(false);
    }

    init();
  }, [currentProjectPath, currentConfig]);

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
  const handleProjectPathChange = useCallback((newPath: string) => {
    setCurrentProjectPath(newPath);
  }, []);

  // Handle sprint status changes (runtime only - active droids, etc.)
  const handleSprintStatusChange = useCallback((status: SprintStatus | null) => {
    setSprintStatus(status);
  }, []);

  // Handle new sprint creation
  const handleSprintCreated = useCallback((status: SprintStatus) => {
    setSprintStatus(status);
    setScreen("continue-sprint");
  }, []);

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
      setSprintStatus({
        ...sprintStatus,
        sprint: {
          ...sprintStatus.sprint,
          shards: updatedShards,
        },
      });
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
      default:
        return <MainMenu onSelect={setScreen} sprintStatus={sprintStatus} />;
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Header
        projectName={currentConfig.project_name}
        sprintStatus={sprintStatus}
      />
      {renderScreen()}
    </Box>
  );
}
