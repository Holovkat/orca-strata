import React, { useState } from "react";
import { Box, Text } from "ink";
import { MainMenu } from "./screens/MainMenu.js";
import { NewSprint } from "./screens/NewSprint.js";
import { ContinueSprint } from "./screens/ContinueSprint.js";
import { ViewStatus } from "./screens/ViewStatus.js";
import { ManualActions } from "./screens/ManualActions.js";
import { Settings } from "./screens/Settings.js";
import { Header } from "./components/Header.js";
import type { OrcaConfig, Screen, SprintStatus } from "./lib/types.js";

interface AppProps {
  config: OrcaConfig;
  projectPath: string;
}

export function App({ config, projectPath }: AppProps) {
  const [screen, setScreen] = useState<Screen>("main");
  const [sprintStatus, setSprintStatus] = useState<SprintStatus | null>(null);
  const [currentConfig, setCurrentConfig] = useState(config);

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
            onSprintCreated={(status) => {
              setSprintStatus(status);
              setScreen("continue-sprint");
            }}
          />
        );
      case "continue-sprint":
        return (
          <ContinueSprint
            config={currentConfig}
            projectPath={projectPath}
            sprintStatus={sprintStatus}
            onBack={() => setScreen("main")}
            onStatusChange={setSprintStatus}
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
