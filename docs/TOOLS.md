# AI Tools

Tools are registered in `src/ai/registry.ts` and defined in `src/ai/tools/`. Each tool calls the Action_Layer only. All tools below are implemented in `src/ai/tools/` and registered with `registerCoreTools()`.

| Tool | Action | Destructive | Task |
|---|---|---|---|
| `list_folder` | listFolder | no | 7.9 |
| `create_folder` | createFolder | no | 7.9 |
| `read_file_metadata` | readMetadata | no | 7.9 |
| `read_document` | readDocument (WordPad, TXT, MD as plain text) | no | 7.9 |
| `create_document` | createDocument | when `overwrite: true` | 7.9 |
| `update_document` | updateDocument | yes for every mode except `append` | 7.9 |
| `insert_image_into_document` | insertImageIntoDocument | no | 7.9 |
| `generate_image` | generateImage (`/api/generate-image` then createDrawing) | when `overwrite: true` | 7.9 |
| `create_drawing` | createDrawing | no | 7.9 |
| `update_drawing` | updateDrawing | yes (scope: paint) | 7.9 |
| `delete_node` | deleteNode | yes | 7.9 |
| `rename_node` | renameNode | no | 7.9 |
| `move_node` | moveNode | no | 7.9 |
| `open_file` | openFile | no | 7.9 |
| `open_application` | openApplication | no | 7.9 |
| `run_command` | executeCommand | no (scope: cmd) | 7.9 |
| `search_files` | searchFiles | no | 9.6 |
| `organize_files` | organizeFiles | yes (confirmation lists every move) | 9.8 |

Limits: file lists capped at 50 entries, text at 4 KB, `contentHtml` at 64 KB. Image bytes never return to Gemini.

Notes:
- Destructive predicates are synchronous. A create tool with an existing target and no overwrite returns CONFLICT_OVERWRITE; the model retries with overwrite: true, which triggers confirmation.
- Tools without `appScope` are always exposed. Scoped: `update_drawing` (paint), `run_command` (cmd).
- Results: `create_document` and `generate_image` return `{ fileId, path }`; `read_document` returns `{ fileId, path, text, truncated }`; `create_folder` returns `{ id, path }`; `list_folder` returns at most 50 items with `total` and `truncated`.
- insert_image_into_document.position is { afterHeading }, { pos }, or omitted (end).

- `search_files` input: `text` (keywords), `type` (pdf, txt, md, wpd, png, jpg, jpeg, folder), and ISO 8601 `createdAfter`, `createdBefore`, `modifiedAfter`, `modifiedBefore` (a date without a time makes an upper bound include that whole day). At least one is required. It returns `{ total, truncated, hits: [{ id, name, path, type, title, description, category, createdAt, modifiedAt }] }`, ranked, at most 50. Scripts reference a hit as `{{step1.hits.0.id}}`. It calls the structured `searchFiles` action directly; natural-language query planning (`/api/search-query`) is used by the Explorer search bar only.

- `organize_files` input: `moves` (1 to 50 items), each with `path` or `fileId` and `destinationPath` (full folder path). It is always destructive. `describeForConfirm` prints one line per move (`name -> destination`, first 20 shown) so declining moves nothing. Missing destination folders are created. Moves run in order and a failed move does not stop the rest. A fully successful batch returns `{ movedCount, moved: [{ fileId, to }] }`. If any move fails, the tool returns a `WRITE_FAILED` error whose details hold `moved` and `failed`, so a partial batch is never reported as success. The Explorer's "Organize with AI..." button uses a separate path: `proposeOrganization` (calls `/api/organize` with names and AI metadata only, never file content; validates destinations stay under `C:\`, reuses existing folders case-insensitively, drops no-op moves), then `OrganizeProposalDialog` lets the user uncheck or edit rows, and `organizeFiles` applies the result.
