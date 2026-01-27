#!/usr/bin/env bun
import { program } from "commander";
import { render } from "ink";
import React from "react";
import { App } from "./App.js";
import { loadConfig } from "./lib/config.js";

program
  .name("orca")
  .description("Menu-driven orchestrator for AI-powered development workflows")
  .version("0.1.0")
  .option("-p, --project <path>", "Project directory", process.cwd())
  .option("-c, --config <path>", "Config file path", ".orchestrator.yaml")
  .action(async (options) => {
    const config = await loadConfig(options.project, options.config);
    render(<App config={config} projectPath={options.project} />);
  });

program.parse();
