import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { Menu, type MenuItem } from "../components/Menu.js";
import { QuestionPrompt } from "../components/QuestionPrompt.js";
import { StatusMessage } from "../components/StatusMessage.js";
import { Spinner } from "../components/Spinner.js";
import { getAllModels, type CustomModel } from "../lib/models.js";
import type { OrcaConfig } from "../lib/types.js";

interface SettingsProps {
  config: OrcaConfig;
  onBack: () => void;
  onConfigChange: (config: OrcaConfig) => void;
}

type SubScreen = "menu" | "edit-name" | "edit-model" | "edit-auto" | "edit-app-url" | "edit-workspace" | "edit-project-path";

export function Settings({ config, onBack, onConfigChange }: SettingsProps) {
  const [subScreen, setSubScreen] = useState<SubScreen>("menu");
  const [message, setMessage] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);
  const [models, setModels] = useState<CustomModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  // Load models when entering model selection
  useEffect(() => {
    if (subScreen === "edit-model") {
      setLoadingModels(true);
      getAllModels().then((m) => {
        setModels(m);
        setLoadingModels(false);
      });
    }
  }, [subScreen]);

  useInput((input, key) => {
    if (key.escape) {
      if (subScreen === "menu") {
        onBack();
      } else {
        setSubScreen("menu");
      }
    }
  });

  // Find current model display name
  const currentModelDisplay = models.find(m => m.id === config.droids.model)?.displayName 
    || config.droids.model;

  const menuItems: MenuItem[] = [
    {
      label: "Project Name",
      value: "edit-name",
      hint: config.project_name,
    },
    {
      label: "Workspace Root",
      value: "edit-workspace",
      hint: config.workspace_root || "(current directory)",
    },
    {
      label: "Project Path",
      value: "edit-project-path",
      hint: config.project_path || "(workspace root)",
    },
    {
      label: "Droid Model",
      value: "edit-model",
      hint: currentModelDisplay.length > 30 
        ? currentModelDisplay.slice(0, 27) + "..." 
        : currentModelDisplay,
    },
    {
      label: "Auto Level",
      value: "edit-auto",
      hint: config.droids.auto_level,
    },
    {
      label: "App URL",
      value: "edit-app-url",
      hint: config.app_url,
    },
    {
      label: "View Full Config",
      value: "view-config",
    },
    {
      label: "Back",
      value: "back",
    },
  ];

  const updateConfig = (updates: Partial<OrcaConfig>) => {
    const newConfig = { ...config, ...updates };
    onConfigChange(newConfig);
    setMessage({ type: "success", text: "Configuration updated" });
    setSubScreen("menu");
  };

  const renderSubScreen = () => {
    switch (subScreen) {
      case "edit-name":
        return (
          <QuestionPrompt
            question="Enter project name:"
            type="text"
            defaultValue={config.project_name}
            onAnswer={(answer) => updateConfig({ project_name: answer })}
            onCancel={() => setSubScreen("menu")}
          />
        );

      case "edit-model":
        if (loadingModels) {
          return <Spinner message="Loading models from Factory settings..." />;
        }

        // Group models by type
        const builtinModels = models.filter(m => !m.id.startsWith("custom:"));
        const customModels = models.filter(m => m.id.startsWith("custom:"));

        return (
          <Box flexDirection="column">
            <Text bold color="cyan">Select Droid Model</Text>
            <Text color="gray" dimColor>
              {models.length} models available ({builtinModels.length} builtin, {customModels.length} custom)
            </Text>
            <Box marginTop={1}>
              <Menu
                items={[
                  // Builtin models first
                  ...builtinModels.map(m => ({
                    label: m.displayName,
                    value: m.id,
                    hint: "builtin",
                  })),
                  // Then custom models
                  ...customModels.map(m => ({
                    label: m.displayName,
                    value: m.id,
                    hint: "custom",
                  })),
                  { label: "Cancel", value: "__cancel__" },
                ]}
                onSelect={(value) => {
                  if (value === "__cancel__") {
                    setSubScreen("menu");
                  } else {
                    updateConfig({ droids: { ...config.droids, model: value } });
                  }
                }}
              />
            </Box>
          </Box>
        );

      case "edit-auto":
        return (
          <QuestionPrompt
            question="Select autonomy level:"
            type="select"
            options={["low", "medium", "high"]}
            onAnswer={(answer) =>
              updateConfig({
                droids: {
                  ...config.droids,
                  auto_level: answer as "low" | "medium" | "high",
                },
              })
            }
            onCancel={() => setSubScreen("menu")}
          />
        );

      case "edit-app-url":
        return (
          <QuestionPrompt
            question="Enter app URL:"
            type="text"
            defaultValue={config.app_url}
            onAnswer={(answer) => updateConfig({ app_url: answer })}
            onCancel={() => setSubScreen("menu")}
          />
        );

      case "edit-workspace":
        return (
          <Box flexDirection="column">
            <Text color="cyan">Workspace Root</Text>
            <Text color="gray" dimColor>Base folder where all your projects live</Text>
            <Text color="gray" dimColor>Example: ~/workspace (contains myapp, orca, etc.)</Text>
            <Box marginTop={1}>
              <QuestionPrompt
                question="Enter workspace root path:"
                type="text"
                defaultValue={config.workspace_root || ""}
                onAnswer={(answer) => {
                  // Expand ~ to home directory
                  const expanded = answer?.replace(/^~/, process.env.HOME || "~");
                  updateConfig({ workspace_root: expanded || undefined });
                }}
                onCancel={() => setSubScreen("menu")}
              />
            </Box>
          </Box>
        );

      case "edit-project-path":
        return (
          <Box flexDirection="column">
            <Text color="cyan">Project Path</Text>
            <Text color="gray" dimColor>Project folder name within workspace root</Text>
            <Text color="gray" dimColor>Example: my-test-app → {config.workspace_root || "."}/my-test-app</Text>
            <Box marginTop={1}>
              <QuestionPrompt
                question="Enter project folder name:"
                type="text"
                defaultValue={config.project_path || ""}
                onAnswer={(answer) => updateConfig({ project_path: answer || undefined })}
                onCancel={() => setSubScreen("menu")}
              />
            </Box>
          </Box>
        );

      default:
        return (
          <Menu
            items={menuItems}
            onSelect={(value) => {
              if (value === "back") {
                onBack();
              } else if (value === "view-config") {
                setMessage({
                  type: "info",
                  text: "Config shown below",
                });
              } else {
                setSubScreen(value as SubScreen);
              }
            }}
            title="Settings"
          />
        );
    }
  };

  return (
    <Box flexDirection="column">
      {message && (
        <Box marginBottom={1}>
          <StatusMessage type={message.type} message={message.text} />
        </Box>
      )}
      {renderSubScreen()}
      {subScreen === "menu" && (
        <Box marginTop={1} flexDirection="column">
          <Text bold color="gray">
            Current Configuration:
          </Text>
          <Text color="gray">
            {JSON.stringify(config, null, 2).split("\n").slice(0, 10).join("\n")}
            ...
          </Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color="gray">Esc to go back</Text>
      </Box>
    </Box>
  );
}
