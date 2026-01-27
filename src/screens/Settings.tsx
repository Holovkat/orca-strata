import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Menu, type MenuItem } from "../components/Menu.js";
import { QuestionPrompt } from "../components/QuestionPrompt.js";
import { StatusMessage } from "../components/StatusMessage.js";
import type { OrcaConfig } from "../lib/types.js";

interface SettingsProps {
  config: OrcaConfig;
  onBack: () => void;
  onConfigChange: (config: OrcaConfig) => void;
}

type SubScreen = "menu" | "edit-name" | "edit-model" | "edit-auto" | "edit-app-url";

export function Settings({ config, onBack, onConfigChange }: SettingsProps) {
  const [subScreen, setSubScreen] = useState<SubScreen>("menu");
  const [message, setMessage] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  useInput((input, key) => {
    if (key.escape) {
      if (subScreen === "menu") {
        onBack();
      } else {
        setSubScreen("menu");
      }
    }
  });

  const menuItems: MenuItem[] = [
    {
      label: "Project Name",
      value: "edit-name",
      hint: config.project_name,
    },
    {
      label: "Droid Model",
      value: "edit-model",
      hint: config.droids.model,
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
        return (
          <QuestionPrompt
            question="Select droid model:"
            type="select"
            options={[
              "claude-sonnet-4-5-20250929",
              "claude-opus-4-5-20251101",
              "gpt-5.1-codex",
              "gemini-3-pro-preview",
            ]}
            onAnswer={(answer) =>
              updateConfig({ droids: { ...config.droids, model: answer } })
            }
            onCancel={() => setSubScreen("menu")}
          />
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

      default:
        return (
          <Menu
            items={menuItems}
            onSelect={(value) => {
              if (value === "back") {
                onBack();
              } else if (value === "view-config") {
                // Just show config, stay on menu
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
