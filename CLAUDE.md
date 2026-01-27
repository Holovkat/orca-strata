# Orca - AI Development Orchestrator

## Overview

Orca is a menu-driven TUI orchestrator that coordinates AI-powered development workflows by invoking droids headlessly via `droid exec`.

## Tech Stack

- **Runtime**: Bun
- **UI**: Ink (React for terminal) + React 19
- **Language**: TypeScript
- **CLI**: Commander

## Commands

```bash
bun run dev          # Run in development
bun run build        # Build for distribution
bun run typecheck    # Type check
```

## Project Structure

```
src/
├── cli.tsx              # Entry point
├── App.tsx              # Main app component
├── components/          # Reusable UI components
│   ├── Header.tsx
│   ├── Menu.tsx
│   ├── QuestionPrompt.tsx
│   ├── Spinner.tsx
│   └── StatusMessage.tsx
├── screens/             # Screen components
│   ├── MainMenu.tsx
│   ├── NewSprint.tsx
│   ├── ContinueSprint.tsx
│   ├── ViewStatus.tsx
│   ├── ManualActions.tsx
│   └── Settings.tsx
├── lib/                 # Core logic
│   ├── types.ts         # TypeScript types
│   └── config.ts        # Config loading
└── hooks/               # React hooks
```

## Key Patterns

- All user interaction: **one question at a time**
- Droids invoked via: `droid exec --auto <level> --model <model>`
- Work tracking: GitHub project boards (Kanban)
- Branching: Graphite stacking (branch from previous, not main)
- Isolation: Git worktrees for parallel droid work

## Configuration

Projects use `.orchestrator.yaml`:

```yaml
project_name: "My Project"
tracking:
  mode: "github"
  backlog_board: "Backlog"
droids:
  model: "claude-sonnet-4-5-20250929"
  auto_level: "medium"
app_url: "http://localhost:3000"
```

## Workflow Phases

1. **Planning**: Gather requirements, create shards, create GitHub issues
2. **Build**: Assign droids to shards, monitor completion
3. **Review**: Implementation review, code review, lint/build
4. **UAT**: Browser automation testing
5. **User Acceptance**: Manual user verification
6. **Deploy**: Rebase, push, merge, archive board
