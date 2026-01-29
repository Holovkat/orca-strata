import React, { useState, useEffect } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { join, dirname } from "path";
import { Menu, type MenuItem } from "./Menu.js";
import { Spinner } from "./Spinner.js";
import { QuestionPrompt } from "./QuestionPrompt.js";
import type { OrcaConfig } from "../lib/types.js";

interface ProjectSelectorProps {
  config: OrcaConfig;
  initialProjectPath: string;
  onProjectSelected: (projectPath: string, projectName: string) => void;
}

// Check if a directory looks like a valid project (has features/ or .orchestrator.yaml)
async function isValidProject(path: string): Promise<boolean> {
  try {
    const { stat } = await import("fs/promises");
    // Check for features folder or .orchestrator.yaml
    const featuresExists = await stat(join(path, "features")).then(() => true).catch(() => false);
    const configExists = await stat(join(path, ".orchestrator.yaml")).then(() => true).catch(() => false);
    return featuresExists || configExists;
  } catch {
    return false;
  }
}

export function ProjectSelector({
  config,
  initialProjectPath,
  onProjectSelected,
}: ProjectSelectorProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || 24;
  
  const [loading, setLoading] = useState(true);
  const [currentIsProject, setCurrentIsProject] = useState(false);
  const [subScreen, setSubScreen] = useState<"menu" | "add-existing" | "create-new">("menu");
  const [newProjectPath, setNewProjectPath] = useState("");

  // Check if current directory is a valid project
  useEffect(() => {
    const checkCurrentProject = async () => {
      const isProject = await isValidProject(initialProjectPath);
      setCurrentIsProject(isProject);
      setLoading(false);
    };
    
    checkCurrentProject();
  }, [initialProjectPath]);

  useInput((input) => {
    if (input === "q" && subScreen === "menu") {
      exit();
    }
  });

  if (loading) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">ORCA</Text>
        <Spinner message="Checking project..." />
      </Box>
    );
  }

  // Sub-screen: Add existing project by path
  if (subScreen === "add-existing") {
    return (
      <Box flexDirection="column" padding={1}>
        <Box borderStyle="double" borderColor="cyan" paddingX={2} marginBottom={1}>
          <Text bold color="cyan">ORCA</Text>
          <Text color="gray"> - Add Existing Project</Text>
        </Box>
        <Text color="gray" dimColor>Enter the full path to an existing project folder</Text>
        <Box marginTop={1}>
          <QuestionPrompt
            question="Project path:"
            type="text"
            onAnswer={async (answer) => {
              if (!answer.trim()) {
                setSubScreen("menu");
                return;
              }
              // Expand ~ to home directory
              const expandedPath = answer.startsWith("~/") 
                ? join(process.env.HOME || "~", answer.slice(2))
                : answer;
              
              // Check if path exists
              try {
                const { stat } = await import("fs/promises");
                const stats = await stat(expandedPath);
                if (!stats.isDirectory()) {
                  // Not a directory - could show error, for now just return to menu
                  setSubScreen("menu");
                  return;
                }
                const name = expandedPath.split("/").pop() || "project";
                onProjectSelected(expandedPath, name);
              } catch {
                // Path doesn't exist - could show error
                setSubScreen("menu");
              }
            }}
            onCancel={() => setSubScreen("menu")}
          />
        </Box>
      </Box>
    );
  }

  // Sub-screen: Create new project
  if (subScreen === "create-new") {
    return (
      <Box flexDirection="column" padding={1}>
        <Box borderStyle="double" borderColor="cyan" paddingX={2} marginBottom={1}>
          <Text bold color="cyan">ORCA</Text>
          <Text color="gray"> - Create New Project</Text>
        </Box>
        <Text color="gray" dimColor>
          Enter the path for the new project (can be absolute or relative to current directory)
        </Text>
        <Text color="gray" dimColor>
          Examples: ./my-project, ~/workspace/new-app, /path/to/project
        </Text>
        <Box marginTop={1}>
          <QuestionPrompt
            question="New project path:"
            type="text"
            onAnswer={async (answer) => {
              if (!answer.trim()) {
                setSubScreen("menu");
                return;
              }
              
              // Expand path
              let expandedPath = answer;
              if (answer.startsWith("~/")) {
                expandedPath = join(process.env.HOME || "~", answer.slice(2));
              } else if (answer.startsWith("./") || !answer.startsWith("/")) {
                expandedPath = join(initialProjectPath, answer);
              }
              
              // Extract name from path
              const name = expandedPath.split("/").pop() || "project";
              
              // Signal to create new project at this path
              // The __new__: prefix tells App.tsx to go to project creation flow
              onProjectSelected(`__create__:${expandedPath}`, name);
            }}
            onCancel={() => setSubScreen("menu")}
          />
        </Box>
      </Box>
    );
  }

  // Main menu
  const currentDirName = initialProjectPath.split("/").pop() || "project";
  
  const menuItems: MenuItem[] = [];

  // Current directory is always the first/primary option
  menuItems.push({
    label: currentIsProject ? `${currentDirName} (current)` : `Use Current Directory`,
    value: "current",
    hint: currentIsProject ? "existing project" : initialProjectPath,
  });

  menuItems.push(
    { label: "─────────────", value: "divider-1", disabled: true },
    {
      label: "+ Create New Project",
      value: "new",
      hint: "scaffold a new project folder",
    },
    {
      label: "Open Existing Folder",
      value: "existing",
      hint: "use an existing folder as project",
    },
    { label: "─────────────", value: "divider-2", disabled: true },
    {
      label: "Exit",
      value: "exit",
    }
  );

  return (
    <Box flexDirection="column" padding={1} height={terminalHeight - 1}>
      <Box flexDirection="column" marginBottom={1}>
        <Box borderStyle="double" borderColor="cyan" paddingX={2}>
          <Text bold color="cyan">ORCA</Text>
          <Text color="gray"> - Select Project</Text>
        </Box>
      </Box>
      
      <Box marginBottom={1}>
        <Text color="gray">Current directory: {initialProjectPath}</Text>
      </Box>
      
      <Box flexGrow={1}>
        <Menu
          items={menuItems}
          onSelect={(value) => {
            if (value === "exit") {
              exit();
            } else if (value === "current") {
              onProjectSelected(initialProjectPath, currentDirName);
            } else if (value === "new") {
              setSubScreen("create-new");
            } else if (value === "existing") {
              setSubScreen("add-existing");
            }
          }}
        />
      </Box>
      
      <Box marginTop={1}>
        <Text color="gray">q to quit</Text>
      </Box>
    </Box>
  );
}
