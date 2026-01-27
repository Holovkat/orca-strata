# Build Command-Line Chat Interface

## Required Reading
> **IMPORTANT:** Read this entire shard and ALL linked documents before starting.

- [Chat Protocol](../../docs/design/chat-protocol.md)
- [Chat Session](../../src/lib/chat-session.ts)
- [CLI Entry](../../src/cli.tsx)

## Context
Users need a simple, interactive command-line interface to chat with droids. This interface should provide a REPL-style experience with streaming output, command handling (/exit, /clear, /save), and proper terminal formatting.

## Task
Create src/chat-cli.tsx that implements: (1) Interactive readline-based REPL, (2) Streaming output display for droid responses, (3) Special commands (/exit, /clear, /save, /load, /help), (4) Session initialization with droid selection, (5) Error display and recovery, (6) Clean exit handling.

## New in This Shard
- Interactive chat REPL
- Streaming response display
- Chat-specific commands
- Droid selection interface

## Acceptance Criteria
- [ ] REPL accepts user input and displays responses
- [ ] Streaming responses display in real-time
- [ ] Commands /exit, /clear, /save, /load, /help work correctly
- [ ] User can select which droid to chat with at startup
- [ ] Errors are displayed with helpful messages
- [ ] Clean shutdown on exit or Ctrl+C

## Dependencies
<!-- Auto-populated by orchestrator -->
- Creates: src/chat-cli.tsx
- Depends on: shard-02-chat-session-manager
- Modifies: None

## Linked Issue
GitHub: #TBD
