<coding_guidelines>
# Orca - AI Development Orchestrator

## Overview

Orca is a menu-driven TUI orchestrator that coordinates AI-powered development workflows. It handles **planning and execution control** while delegating actual coding work to Factory Droid via the **stream-jsonrpc** protocol.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      ORCA (TUI)                         │
│  Planning • Worktrees • Progress • Merge • Deploy       │
└─────────────────────────────────────────────────────────┘
                           │
                           │ droid exec --input-format stream-jsonrpc
                           │            --output-format stream-jsonrpc
                           ▼
┌─────────────────────────────────────────────────────────┐
│                   FACTORY DROID                         │
│  Code Generation • File Editing • Git Commits           │
└─────────────────────────────────────────────────────────┘
                           ▲
                           │ JSON-RPC messages
                           ▼
┌─────────────────────────────────────────────────────────┐
│                   DROID ADAPTER                         │
│  Session Management • Streaming • Permission Handling   │
└─────────────────────────────────────────────────────────┘
```

## Tech Stack

- **Runtime**: Bun
- **UI**: Ink (React for terminal) + React 19
- **Language**: TypeScript
- **CLI**: Commander
- **VCS**: Git with worktrees
- **Tracking**: GitHub Issues & Projects

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
│   ├── config.ts        # Config loading
│   ├── git.ts           # Git operations (worktrees, branches, merges)
│   ├── droid.ts         # Droid invocation
│   └── droid-adapter.ts # Stream-jsonrpc adapter for Factory Droid
└── hooks/               # React hooks
```

## Key Patterns

- All user interaction: **one question at a time**
- Droids invoked via: `DroidAdapter` using stream-jsonrpc protocol
- Prompts sent via JSON-RPC, not command-line arguments
- Work tracking: GitHub project boards (Kanban)
- Branching: Graphite stacking (branch from previous, not main)
- Isolation: Git worktrees for parallel droid work
- Merging: Squash merge from last stacked shard

## Droid Integration

```typescript
const adapter = new DroidAdapter({
  cwd: worktreePath,
  model: "claude-sonnet-4-5-20250929",
  autoLevel: "high",
});

await adapter.start();
await adapter.sendPrompt("Implement the feature...");
await adapter.stop();
```

## Configuration

Projects use `.orchestrator.yaml`:

```yaml
project_name: "My Project"
repo: "owner/repo"

tracking:
  mode: "github"
  backlog_board: "Backlog"

paths:
  features: "features/"
  docs: "docs/design/"
  worktrees: ".worktrees/"

droids:
  model: "claude-sonnet-4-5-20250929"
  auto_level: "medium"

app_url: "http://localhost:3000"

branching:
  pattern: "feature/{sprint}-{shard}"
  stack_from: "previous"
```

## Workflow Phases

1. **Planning**: Gather requirements, create shards, create GitHub issues
2. **Build**: Assign droids to shards in isolated worktrees, monitor completion
3. **Review**: Implementation review, code review, lint/build verification
4. **UAT**: Browser automation testing
5. **User Acceptance**: Manual user verification
6. **Deploy**: Squash merge shards, push, cleanup worktrees

## Deploy Phase

- **Merge Shards to Main**: Squash merge from last stacked shard (contains all changes)
- **Cleanup Worktrees**: Removes worktree directories AND deletes shard branches
- User should test app before running cleanup
</coding_guidelines>
