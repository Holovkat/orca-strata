#!/usr/bin/env bun
import { program } from "commander";
import { render } from "ink";
import React from "react";
import { join } from "path";
import { App } from "./App.js";
import { loadConfig } from "./lib/config.js";

// Resolve project path from config or options
function resolveProjectPath(config: { workspace_root?: string; project_path?: string }, optionPath: string): string {
  // If explicit project path given via CLI, use it
  if (optionPath !== process.cwd()) {
    return optionPath;
  }
  
  // If config has project_path, resolve it
  if (config.project_path) {
    if (config.project_path.startsWith("/") || config.project_path.startsWith("~")) {
      // Absolute path
      return config.project_path.replace(/^~/, process.env.HOME || "~");
    }
    // Relative to workspace_root or cwd
    const base = config.workspace_root?.replace(/^~/, process.env.HOME || "~") || process.cwd();
    return join(base, config.project_path);
  }
  
  // Default to current directory
  return process.cwd();
}

program
  .name("orca")
  .description("Menu-driven orchestrator for AI-powered development workflows")
  .version("0.1.0")
  .option("-p, --project <path>", "Project directory", process.cwd())
  .option("-w, --workspace <path>", "Workspace root directory (where projects live)")
  .option("-c, --config <path>", "Config file path", ".orchestrator.yaml")
  .action(async (options) => {
    const config = await loadConfig(options.project, options.config);
    
    // Apply workspace override from CLI if provided
    if (options.workspace) {
      config.workspace_root = options.workspace.replace(/^~/, process.env.HOME || "~");
    }
    
    // Set workspace_root to current directory if not set (first run detection)
    if (!config.workspace_root) {
      config.workspace_root = process.cwd();
    }
    
    const projectPath = resolveProjectPath(config, options.project);
    
    render(
      <App 
        config={config} 
        projectPath={projectPath} 
        configFile={options.config}
      />
    );
  });

program.parse();
