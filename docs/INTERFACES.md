# Interfaces

Authoritative definitions are in `design.md` ("Components and Interfaces"). This file lists the contracts and where they will live. Update the status as each is implemented.

| Interface | Location | Status |
|---|---|---|
| `AppError`, `ErrorCode`, `Result<T>` | `shared/errors.ts` | Implemented (1.1) |
| `WindowState`, `WindowStore` | `src/store/windows.ts` | In progress (1.2) |
| API request/response schemas | `shared/api-contracts.ts` | In progress (7.1) |
| `NodeRecord`, `NodeMeta`, `ContentRecord`, `VfsService`, `VfsEvent` | `src/vfs/` | Planned (3.1, 3.2) |
| `CoreActions` (core subset of `Actions`, see below) | `src/actions/` | Implemented (3.11). Remaining actions: 5.1, 5.10, 9.6, 9.8 |
| `ToolDef`, `ToolContext` | `src/ai/registry.ts` | Planned (7.7) |
| `OrchestratorRun`, `OrchestratorResult`, `AiContextSnapshot` | `src/ai/orchestrator.ts`, `src/ai/types.ts` | Implemented (7.12) |
| `AppContextProvider`, `AppContextSnapshot` | `src/ai/context.tsx` | Planned (7.10) |

## HTTP endpoints (AI_Proxy)

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | `{ ok, ai }` |
| `POST /api/chat` | One Gemini turn with function declarations |
| `POST /api/generate-image` | Image generation, returns base64 |
| `POST /api/metadata` | AI title, description, category, tags |
| `POST /api/search-query` | Natural-language query planning |
| `POST /api/organize` | Folder organization proposal |
| `POST /api/text-transform` | generate, rewrite, summarize, proofread, expand |

## Action_Layer core (`src/actions`)

Import `actions` from `src/actions` (bound to the shared VFS and window store) or build one with `createCoreActions({ vfs, launch })` for tests. Every action returns `Result<T>` and never throws. Unexpected exceptions become `WRITE_FAILED`. Nodes are addressed by id or path; paths may be relative to an optional `cwd`. When both id and path are given, the id wins.

```ts
openApplication({ appId, launchArgs? }): Result<{ windowId }>            // NOT_FOUND if app not registered
openFile({ fileId?, path?, cwd? }): Result<{ windowId, appId }>          // file -> appForFileName, launchArgs { fileId }
                                                                          // folder -> 'explorer', launchArgs { folderId }
                                                                          // UNSUPPORTED_TYPE if unmapped or app not registered
saveFile({ fileId?, path?, cwd?, bytes, mime, overwrite? }): Result<{ fileId, path }>
                                                                          // existing target without overwrite:true -> CONFLICT_OVERWRITE
                                                                          // missing path -> created in its parent folder
listFolder({ folderId?, path?, cwd? }): Result<{ folder: NodeInfo, items: NodeRecord[] }>
createFolder({ path, cwd? } | { parentId, name }): Result<NodeInfo>
readMetadata({ nodeId?, path?, cwd? }): Result<NodeInfo & { meta }>
deleteNode({ nodeId?, path?, cwd? }): Result<{ removedIds, path }>       // no confirmation here; callers confirm
renameNode({ nodeId?, path?, cwd?, name }): Result<NodeInfo>
moveNode({ nodeId?, path?, cwd?, destinationId?, destinationPath?, newName? }): Result<NodeInfo>
// NodeInfo = { node: NodeRecord, path: string }
```

## Orchestrator (`src/ai/orchestrator.ts`, types in `src/ai/types.ts`)

```ts
runOrchestrator(run: OrchestratorRun, deps?: OrchestratorDeps): Promise<OrchestratorResult>
// OrchestratorRun   { userText, context?: AiContextSnapshot, history?: PriorTurn[] (last 6 used), confirm(req): Promise<boolean>, onEvent?, signal? }
// AiContextSnapshot { activeApp?, snapshot?: unknown, cwdHint? }   // task 7.10 builds this from the focused window's provider only
// OrchestratorResult{ finalText, report, steps[], stoppedBy: 'model_done'|'limit'|'error'|'aborted', error? }
// step.status       'ok' | 'error' | 'declined' | 'invalid' | 'unknown_tool'
// RunEvent          { type:'thinking' } | { type:'tool_start', tool, args } | { type:'tool_end', step }
// OrchestratorDeps  { client?, registry?, actions?, maxToolCalls?=10, maxRounds?=12 }  // all injectable for tests
```

Rules: model turns are echoed verbatim into history; calls run sequentially; every received call counts toward the 10-call limit (unknown and invalid included); extra calls get `LIMIT_REACHED` and the run stops with `stoppedBy: 'limit'`. Unknown tool returns `UNKNOWN_TOOL`, bad args `VALIDATION`, a declined destructive call `DECLINED`; none run a handler. `report` is built from `steps` only (`buildReport`), lists only handlers that returned ok as completed, and names the first failed step. Show `report` next to `finalText`; never treat `finalText` as proof of success.

`src/ai/confirm.tsx`: `requestAiConfirmation(req): Promise<boolean>` and `<AiConfirmHost/>` (mounted in `Desktop`). Pass `requestAiConfirmation` as `run.confirm`.

## Context_Providers (`src/ai/context.tsx`)
```ts
useContextProvider(appId, windowId, describe: () => AppContextSnapshot | undefined): void  // hook; registers while mounted
registerContextProvider({ appId, windowId, describe }): () => void
buildAiContext(focusedWindowId?): AiContextSnapshot  // defaults to useWindowStore focusedId
// AppContextSnapshot: wordpad {fileId,path,selection,docTextExcerpt} | paint {fileId,path,dirty,width,height} | explorer {folderId,folderPath,selectedIds} | cmd {cwd}
```n
Only the focused window's provider is read. selection.text is cut to 4000 chars, docTextExcerpt to 2000. cwdHint is set for cmd and explorer. No file bytes or full documents are included.


## Search (`src/actions/search.ts`, `src/actions/searchIndex.ts`)
```ts
searchFiles({ text?, type?, createdAfter?, createdBefore?, modifiedAfter?, modifiedBefore?, limit? }): Promise<Result<SearchHit[]>>
searchNatural({ query, filters?, limit? }): Promise<Result<{ plan: SearchPlan; hits: SearchHit[] }>>   // plans via /api/search-query, else raw text + chrono-node
// SearchHit: { id, name, kind, type, path, location, title, description, category, createdAt, modifiedAt, score }
searchIndex.start() / ready() / search(text, filters) / categories()   // MiniSearch, rebuilt from the VFS on start, updated from VFS events
```
Fields indexed: name, text (txt, md, wpd), extractedText, title, description, category, tags, notes. Stopwords and request words ("document", "file") are dropped from queries. `searchFiles` needs text or a filter (VALIDATION otherwise).
