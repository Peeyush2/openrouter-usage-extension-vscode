# Graph Report - OprouterExtension  (2026-10-10)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 171 nodes · 269 edges · 11 communities
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 8 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `16b13200`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- package.json
- extension.ts
- openrouterUsage.refreshIntervalSeconds
- api.ts
- scripts
- devDependencies
- activate
- compilerOptions
- esbuild.js
- contributes
- capabilities

## God Nodes (most connected - your core abstractions)
1. `scripts` - 15 edges
2. `UsageMonitor` - 14 edges
3. `activate()` - 14 edges
4. `OpenRouterClient` - 11 edges
5. `OpenRouterError` - 10 edges
6. `UsageView` - 9 edges
7. `compilerOptions` - 8 edges
8. `parseKeyUsage()` - 7 edges
9. `validateAndSaveKey()` - 7 edges
10. `openrouterUsage.refreshIntervalSeconds` - 7 edges

## Surprising Connections (you probably didn't know these)
- `activate()` --indirect_call--> `validateApiKey()`  [INFERRED]
  src/extension.ts → src/api.ts
- `activate()` --calls--> `UsageView`  [EXTRACTED]
  src/extension.ts → src/usageView.ts
- `activate()` --calls--> `OpenRouterClient`  [EXTRACTED]
  src/extension.ts → src/api.ts
- `activate()` --calls--> `updateStatusBar()`  [EXTRACTED]
  src/extension.ts → src/usageView.ts
- `activate()` --calls--> `validateAndSaveKey()`  [EXTRACTED]
  src/extension.ts → src/credentials.ts

## Import Cycles
- None detected.

## Communities (11 total, 0 thin omitted)

### Community 0 - "package.json"
Cohesion: 0.07
Nodes (26): activationEvents, categories, description, displayName, engines, vscode, extensionKind, license (+18 more)

### Community 1 - "extension.ts"
Cohesion: 0.16
Nodes (13): AccountCredits, KeyUsage, apiKeySecret, Endpoint, managementKeySecret, UsageState, formatOptionalUsd(), formatUsd() (+5 more)

### Community 2 - "openrouterUsage.refreshIntervalSeconds"
Cohesion: 0.07
Nodes (27): properties, title, configuration, default, description, scope, type, default (+19 more)

### Community 3 - "api.ts"
Cohesion: 0.29
Nodes (10): number(), object(), OpenRouterClient, OpenRouterError, optionalNumber(), parseAccountCredits(), parseKeyUsage(), retryAfterMilliseconds() (+2 more)

### Community 4 - "scripts"
Cohesion: 0.13
Nodes (15): scripts, check-types, compile, compile-tests, lint, package, package:vsix, pretest (+7 more)

### Community 5 - "devDependencies"
Cohesion: 0.15
Nodes (13): devDependencies, esbuild, eslint, mocha, npm-run-all, @types/mocha, @types/node, @types/vscode (+5 more)

### Community 6 - "activate"
Cohesion: 0.32
Nodes (3): activate(), safeError(), UsageMonitor

### Community 7 - "compilerOptions"
Cohesion: 0.22
Nodes (8): compilerOptions, lib, module, rootDir, sourceMap, strict, target, types

### Community 8 - "esbuild.js"
Cohesion: 0.33
Nodes (5): esbuildProblemMatcherPlugin, main(), production, watch, esbuild

### Community 9 - "contributes"
Cohesion: 0.29
Nodes (7): contributes, commands, menus, views, viewsWelcome, view/title, explorer

### Community 10 - "capabilities"
Cohesion: 0.40
Nodes (5): capabilities, untrustedWorkspaces, virtualWorkspaces, supported, supported

## Knowledge Gaps
- **9 isolated node(s):** `eslint`, `mocha`, `npm-run-all`, `@types/mocha`, `@types/node` (+4 more)
  These have ≤1 connection - possible missing edges. (Counts symbols only; 99 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `contributes` connect `contributes` to `package.json`, `openrouterUsage.refreshIntervalSeconds`?**
  _High betweenness centrality (0.171) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `activate()` (e.g. with `validateApiKey()` and `.configureTimer()`) actually correct?**
  _`activate()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **What connects `eslint`, `mocha`, `npm-run-all` to the rest of the system?**
  _9 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.06896551724137931 - nodes in this community are weakly interconnected._
- **Why does `configuration` connect `openrouterUsage.refreshIntervalSeconds` to `contributes`?**
  _High betweenness centrality (0.139) - this node is a cross-community bridge._
- **Should `openrouterUsage.refreshIntervalSeconds` be split into smaller, more focused modules?**
  _Cohesion score 0.07407407407407407 - nodes in this community are weakly interconnected._
- **Should `scripts` be split into smaller, more focused modules?**
  _Cohesion score 0.13333333333333333 - nodes in this community are weakly interconnected._