# Agent Development Guide - qwqnt-community-indexes

This document provides essential information for agentic coding agents operating in this repository.

## Repository Overview
This project indexes repositories within the `qwqnt-community` GitHub organization that have specific topics (e.g., `qwqnt-framework-plugin`). It tracks updates and notifies a Telegram group via a bot.

The core logic revolves around:
1. Searching for repositories with the specified topic.
2. Checking for new commits or releases.
3. Updating or sending messages in a Telegram group.
4. Persisting the state (message IDs, last processed commit SHAs) as JSON files in a dedicated `data` branch.

## Technical Stack
- **Runtime**: Node.js (v20+)
- **Module System**: ES Modules (ESM)
- **APIs**:
  - GitHub: `@octokit/rest`
  - Telegram: `grammy`
- **Data Persistence**: JSON files stored on the `data` branch.
- **CI/CD**: GitHub Actions for scheduled runs.

## Essential Commands

### Build & Run
- **Install dependencies**: `npm install` (or `npm ci` in CI environments)
- **Main indexing process**: `npm run index` - This executes `src/main.js` which performs the full scan and update.
- **Manual trigger**: `npm run manual` - This executes `src/manual.js`.

### Testing & Linting
- **Tests**: No testing framework is currently configured. If adding tests, consider using `vitest` or `node:test`.
- **Linting**: No linter is currently configured. Code should follow existing style manually.

## Code Style Guidelines

### Formatting & Syntax
- **Indentation**: 4 spaces.
- **Semicolons**: Always use semicolons at the end of statements.
- **Quotes**: Prefer double quotes for strings (`"string"`). Use single quotes for characters or specific tokens if they improve readability.
- **Trailing Commas**: Use trailing commas in multi-line objects and arrays to minimize diff noise.
- **Newlines**: Ensure a single newline at the end of every file.

### Naming Conventions
- **Variables & Functions**: `camelCase`.
- **Classes**: `PascalCase`.
- **Environment Variables & Constants**: `UPPER_SNAKE_CASE`.
- **Files**: `lowercase.js` or `kebab-case.js`.

### Imports & Exports
- Use ES Modules (`import`/`export`).
- File extensions **must** be included in local imports (e.g., `import { ... } from "./github/repos.js";`).
- Group imports: standard libraries first, then third-party dependencies, then local modules.

### Error Handling
- Use `try...catch` blocks in asynchronous functions to prevent unhandled promise rejections.
- Log errors using `console.error` with descriptive messages, including the context (e.g., repository name or function name).
- For critical missing configuration (like environment variables), use `process.exit(1)` at the module level or early in the main function.
- In utility functions, prefer returning `null` or empty values on non-critical failures if the caller can handle it gracefully.

### Documentation
- Use JSDoc for all exported functions and complex internal logic.
- **Language**: Comments and JSDoc should be in **Chinese**, following the existing codebase style.
- Include `@param` and `@returns` tags for all functions.

### Environment Variables
The following environment variables are required for the application to function:
- `CUSTOM_GITHUB_TOKEN`: GitHub personal access token with repo and workflow scopes.
- `GITHUB_ORGANIZATION`: The GitHub organization to scan (e.g., `qwqnt-community`).
- `GITHUB_REPOSITORY`: The current repository path (e.g., `owner/repo`).
- `PLUGIN_TOPIC`: The topic to search for (e.g., `qwqnt-framework-plugin`).
- `TG_BOT_TOKEN`: Telegram bot token from @BotFather.
- `TG_GROUP_ID`: Telegram group/channel ID where notifications are sent.
- `TG_GROUP_TOPIC_ID`: (Optional) Telegram topic ID within the group for threaded chats.
- `FORCE_RESEND`: (Optional) Set to `true` or `1` to force resending all messages.

## Project Structure
- `src/main.js`: Primary entry point. Orchestrates the full workflow by processing repositories in a loop.
- `src/manual.js`: Script for manual operations or testing specific logic.
- `src/github/`:
  - `client.js`: Octokit client initialization and environment check.
  - `repos.js`: GitHub repository searching, metadata retrieval (commits, releases, info).
  - `data.js`: State persistence logic. Uses Octokit for reading and local Git commands for writing to the `data` branch.
- `src/telegram/`:
  - `bot.js`: Telegram bot initialization, MarkdownV2 escaping, and message syncing logic. Uses a consolidated `context` object for message formatting.

## Contribution Workflow & Best Practices

### Message Handling
- Use `formatRepoMessage(context)` in `src/telegram/bot.js` to build the Markdown text.
- Use `syncRepoMessage(oldMessageId, context)` to handle the "delete-and-resend" logic.
- The `context` object should contain `owner`, `repo`, `description`, `stars`, `releaseInfo` (object with `tagName`, `publishedAt`, `assets`), and `recentCommits` (array of `{sha, message, date}`).

### Data Persistence
- State is stored in `repos/{owner}/{repo}.json` on the `data` branch.
- `clearDataBranch()` must be called before batch updates to ensure a clean state if force-pushing is intended, or simply to switch to the correct branch.
- Use `batchSaveRepoData(updates)` to commit all changes at once.

### Adding New Features
1. **Analyze existing patterns**: If adding a new GitHub-related feature, place it in `src/github/`.
2. **Handle environment variables**: Add any new configuration to the environment check blocks.
3. **Maintain Chinese comments**: Ensure consistency in documentation language.
4. **Test manual execution**: Use `src/manual.js` to test new logic before integrating into `src/main.js`.
