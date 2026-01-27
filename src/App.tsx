import React, { useState, useEffect, useCallback } from "react";
import { Box, Text } from "ink";
import { MainMenu } from "./screens/MainMenu.js";
import { NewSprint } from "./screens/NewSprint.js";
import { ContinueSprint } from "./screens/ContinueSprint.js";
import { ViewStatus } from "./screens/ViewStatus.js";
import { ManualActions } from "./screens/ManualActions.js";
import { Settings } from "./screens/Settings.js";
import { Header } from "./components/Header.js";
import { Spinner } from "./components/Spinner.js";
import { loadState, saveState, scanForSprints } from "./lib/state.js";
import type { OrcaConfig, Screen, SprintStatus } from "./lib/types.js";

interface AppProps {
  config: OrcaConfig;
  projectPath: string;
}

export function App({ config, projectPath }: AppProps) {
  const [screen, setScreen] = useState<Screen>("main");
  const [sprintStatus, setSprintStatus] = useState<SprintStatus | null>(null);
  const [currentConfig, setCurrentConfig] = useState(config);
  const [loading, setLoading] = useState(true);
  const [availableSprints, setAvailableSprints] = useState<string[]>([]);

  // Load state on startup
  useEffect(() => {
    async function init() {
      // Try to load persisted state
      const savedState = await loadState(projectPath);
      
      if (savedState) {
        setSprintStatus(savedState);
      } else {
        // Scan for existing sprints in features folder
        const sprints = await scanForSprints(projectPath, currentConfig.paths.features);
        if (sprints.length > 0) {
          setAvailableSprints(sprints.map(s => s.name));
          // Auto-load the first sprint found
          const firstSprint = sprints[0]!;
          const counts = {
            total: firstSprint.shards.length,
            readyToBuild: firstSprint.shards.filter(s => s.status === "Ready to Build").length,
            inProgress: firstSprint.shards.filter(s => s.status === "In Progress").length,
            readyForReview: firstSprint.shards.filter(s => s.status === "Ready for Review").length,
            inReview: firstSprint.shards.filter(s => s.status === "In Review").length,
            readyForUat: firstSprint.shards.filter(s => s.status === "Ready for UAT").length,
            uatInProgress: firstSprint.shards.filter(s => s.status === "UAT in Progress").length,
            userAcceptance: firstSprint.shards.filter(s => s.status === "User Acceptance").length,
            done: firstSprint.shards.filter(s => s.status === "Done").length,
          };
          setSprintStatus({
            sprint: firstSprint,
            counts,
            activeDroids: [],
          });
        }
      }
      
      setLoading(false);
    }
    
    init();
  }, [projectPath, currentConfig.paths.features]);

  // Save state when sprint status changes
  const handleSprintStatusChange = useCallback(
    async (status: SprintStatus | null) => {
      setSprintStatus(status);
      await saveState(projectPath, status);
    },
    [projectPath]
  );

  const handleSprintCreated = useCallback(
    async (status: SprintStatus) => {
      setSprintStatus(status);
      await saveState(projectPath, status);
      setScreen("continue-sprint");
    },
    [projectPath]
  );

  if (loading) {
    return (
      <Box flexDirection="column" padding={1}>
        <Spinner message="Loading project state..." />
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
          />
        );
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
    <Box flexDirection="column" padding={1}>
      <Header
        projectName={currentConfig.project_name}
        sprintStatus={sprintStatus}
      />
      {renderScreen()}
    </Box>
  );
}
