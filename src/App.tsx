import React, { useState, useEffect, useCallback } from "react";
import { Box } from "ink";
import { MouseProvider } from "@zenobius/ink-mouse";
import { MainMenu } from "./screens/MainMenu.js";
import { NewSprint } from "./screens/NewSprint.js";
import { ContinueSprint } from "./screens/ContinueSprint.js";
import { ViewStatus } from "./screens/ViewStatus.js";
import { ManualActions } from "./screens/ManualActions.js";
import { Settings } from "./screens/Settings.js";
import { ShardEditor } from "./screens/ShardEditor.js";
import { Header } from "./components/Header.js";
import { Spinner } from "./components/Spinner.js";
import { deriveSprintStatus, refreshStatus } from "./lib/state.js";
import type { OrcaConfig, Screen, SprintStatus, Shard } from "./lib/types.js";

interface AppProps {
  config: OrcaConfig;
  projectPath: string;
}

export function App({ config, projectPath }: AppProps) {
  const [screen, setScreen] = useState<Screen>("main");
  const [sprintStatus, setSprintStatus] = useState<SprintStatus | null>(null);
  const [currentConfig, setCurrentConfig] = useState(config);
  const [loading, setLoading] = useState(true);
  const [selectedShard, setSelectedShard] = useState<Shard | null>(null);

  // Derive state from sources of truth on startup
  useEffect(() => {
    async function init() {
      const status = await deriveSprintStatus(projectPath, currentConfig);
      setSprintStatus(status);
      setLoading(false);
    }

    init();
  }, [projectPath, currentConfig]);

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
      const refreshed = await refreshStatus(projectPath, currentConfig, sprintStatus);
      setSprintStatus(refreshed);
      setLoading(false);
    }
  }, [projectPath, currentConfig, sprintStatus]);

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
            projectPath={projectPath}
            onBack={() => setScreen("main")}
            onSprintCreated={handleSprintCreated}
          />
        );
      case "continue-sprint":
        return (
          <ContinueSprint
            config={currentConfig}
            projectPath={projectPath}
            sprintStatus={sprintStatus}
            onBack={() => setScreen("main")}
            onStatusChange={handleSprintStatusChange}
          />
        );
      case "view-status":
        return (
          <ViewStatus
            config={currentConfig}
            projectPath={projectPath}
            sprintStatus={sprintStatus}
            onBack={() => setScreen("main")}
            onEditShard={handleEditShard}
          />
        );
      case "shard-editor":
        if (selectedShard) {
          return (
            <ShardEditor
              config={currentConfig}
              projectPath={projectPath}
              shard={selectedShard}
              onBack={() => setScreen("view-status")}
              onShardUpdated={handleShardUpdated}
            />
          );
        }
        return <MainMenu onSelect={setScreen} sprintStatus={sprintStatus} />;
      case "manual-actions":
        return (
          <ManualActions
            config={currentConfig}
            projectPath={projectPath}
            onBack={() => setScreen("main")}
          />
        );
      case "settings":
        return (
          <Settings
            config={currentConfig}
            onBack={() => setScreen("main")}
            onConfigChange={setCurrentConfig}
          />
        );
      default:
        return <MainMenu onSelect={setScreen} sprintStatus={sprintStatus} />;
    }
  };

  return (
    <MouseProvider>
      <Box flexDirection="column" padding={1}>
        <Header
          projectName={currentConfig.project_name}
          sprintStatus={sprintStatus}
        />
        {renderScreen()}
      </Box>
    </MouseProvider>
  );
}
