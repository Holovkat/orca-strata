import React, { useState, useEffect } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { join } from "path";
import { Menu, type MenuItem } from "./Menu.js";
import { Spinner } from "./Spinner.js";
import type { OrcaConfig } from "../lib/types.js";

interface ProjectSelectorProps {
  config: OrcaConfig;
  initialProjectPath: string;
  onProjectSelected: (projectPath: string, projectName: string) => void;
}

export function ProjectSelector({
  config,
  initialProjectPath,
  onProjectSelected,
}: ProjectSelectorProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || 24;
  
  const [existingProjects, setExistingProjects] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Calculate projects directory
  const projectsDir = config.workspace_root 
    ? join(config.workspace_root, "projects")
    : join(initialProjectPath, "projects");

  // Load existing projects
  useEffect(() => {
    const loadProjects = async () => {
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
        
        setExistingProjects(dirs.sort());
      } catch {
        setExistingProjects([]);
      }
      setLoading(false);
    };
    
    loadProjects();
  }, [projectsDir]);

  useInput((input) => {
    if (input === "q") {
      exit();
    }
  });

  if (loading) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">ORCA</Text>
        <Spinner message="Scanning for projects..." />
      </Box>
    );
  }

  const menuItems: MenuItem[] = [
    ...existingProjects.map(name => ({
      label: name,
      value: `project:${name}`,
      hint: "existing project",
    })),
  ];

  // Add separator if there are existing projects
  if (existingProjects.length > 0) {
    menuItems.push({ label: "─────────────", value: "divider-1", disabled: true });
  }

  menuItems.push(
    {
      label: "+ Create New Project",
      value: "new",
      hint: "scaffold a new project",
    },
    {
      label: "Use Current Directory",
      value: "current",
      hint: initialProjectPath.split("/").pop() || initialProjectPath,
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
        <Text color="gray">Projects folder: {projectsDir}</Text>
      </Box>
      
      {existingProjects.length === 0 && (
        <Box marginBottom={1}>
          <Text color="yellow">No existing projects found</Text>
        </Box>
      )}
      
      <Box flexGrow={1}>
        <Menu
          items={menuItems}
          onSelect={(value) => {
            if (value === "exit") {
              exit();
            } else if (value === "current") {
              const name = initialProjectPath.split("/").pop() || "project";
              onProjectSelected(initialProjectPath, name);
            } else if (value === "new") {
              // Signal to go to new project creation
              onProjectSelected("__new__", "");
            } else if (value.startsWith("project:")) {
              const name = value.replace("project:", "");
              onProjectSelected(join(projectsDir, name), name);
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
