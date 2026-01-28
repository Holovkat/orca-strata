# Orca

A menu-driven TUI orchestrator that coordinates AI-powered development workflows. Orca handles **planning and execution control** while delegating actual coding work to [Factory Droid](https://github.com/factory-ai/droid) - the AI coding agent.

## Why Orca?

Modern AI coding agents are powerful but need guardrails. Orca provides:

- **Structured workflows** - Phases (Plan → Build → Review → UAT → Deploy) keep work organized
- **Work isolation** - Git worktrees let droids work in parallel without conflicts
- **Model-agnostic** - Works with any model supported by Factory Droid
- **Human-in-the-loop** - You approve shards, review output, and control deployments

## How It Works

Orca is a **controller**, not a coding agent. It:

1. **Plans work** - Breaks features into shards with dependencies
2. **Manages isolation** - Creates git worktrees for parallel droid work
3. **Invokes droids** - Calls `droid exec` with shard context and constraints
4. **Tracks progress** - Monitors completion, handles failures, manages state
5. **Orchestrates merges** - Uses Graphite-style branch stacking for clean history

```
┌─────────────────────────────────────────────────────────┐
│                      ORCA (TUI)                         │
│  Planning • Worktrees • Progress • Merge • Deploy       │
└─────────────────────────────────────────────────────────┘
                           │
                           │ droid exec --auto <level>
                           ▼
┌─────────────────────────────────────────────────────────┐
│                   FACTORY DROID                         │
│  Code Generation • File Editing • Git Commits           │
└─────────────────────────────────────────────────────────┘
```

## Prerequisites

- [Factory Droid CLI](https://docs.factory.ai) installed and configured
- Git 2.20+ (for worktree support)
- Bun runtime

## Installation

```bash
# With bun (recommended)
bun install -g orca-cli

# With npm
npm install -g orca-cli

# From source
git clone <repo>
cd orca
bun install
bun run build
npm link
```

## Usage

```bash
orca
```

This launches the interactive TUI where you can:
- Plan and create sprints
- Assign AI droids to work shards
- Monitor build progress
- Review and test implementations
- Deploy completed work

## Configuration

Create `.orchestrator.yaml` in your project root:

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

1. **Planning** - Gather requirements, create shards, create GitHub issues
2. **Build** - Assign droids to shards, monitor completion
3. **Review** - Implementation review, code review, lint/build
4. **UAT** - Browser automation testing
5. **User Acceptance** - Manual user verification
6. **Deploy** - Merge shards, push, cleanup

## Droid Integration

Orca uses Factory Droid's stock CLI via the **stream-jsonrpc** protocol - no custom agents or plugins required.

### How Droids Are Invoked

Orca spawns droid sessions programmatically:

```bash
droid exec --input-format stream-jsonrpc --output-format stream-jsonrpc \
  --cwd /path/to/worktree --auto high --model claude-sonnet-4-5-20250929
```

Prompts are sent via JSON-RPC messages, not command-line arguments. This enables:
- **Streaming output** - Real-time progress in the TUI
- **Session persistence** - Multiple prompts in one session
- **Programmatic control** - Permission handling, model switching

### Auto Levels

The `--auto` level controls droid autonomy:
- `low` - Asks before most actions
- `medium` - Asks before destructive actions
- `high` - Fully autonomous (recommended for isolated worktrees)

### Shard Context

Each droid session receives a prompt containing:
- Shard file path with requirements and acceptance criteria
- Isolated worktree directory to work in
- Model override (per-shard or from config)
- Instructions to commit when complete

### Output Streaming

Droid output streams to the TUI in real-time. You can:
- Watch progress as the droid works
- Press `Esc` to minimize and continue working
- View running droids from the menu

## Development

```bash
bun run dev          # Run in development
bun run build        # Build for distribution
bun run typecheck    # Type check
```

## Tech Stack

- **Runtime**: Bun
- **UI**: Ink (React for terminal) + React 19
- **Language**: TypeScript
- **CLI**: Commander

## License

MIT
