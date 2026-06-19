> **Русская версия:** [indexing-system.md](../ru/systems/indexing-system.md)

# Codebase Indexing System

Semantic indexing for intelligent code search. Enables the AI agent to retrieve relevant context from the entire project before responding.

Runs fully locally by default (transformers.js, WASM), with an option to connect a remote API.

## Architecture

```
IndexingService (orchestrator) — src/core/indexing/IndexingService.ts
├── FileWalker (file traversal)
│   └── Respects .gitignore, ignoredPatterns, maxFileSize, binary files
├── CodeChunker (splitting into chunks)
│   └── Tree-sitter chunking (with fallback to simple chunker)
├── EmbeddingRouter → provider selection
│   ├── LocalEmbeddingProvider (transformers.js WASM + multilingual MiniLM)
│   └── RemoteEmbeddingProvider (OpenAI-compatible /v1/embeddings API)
├── Storage
│   ├── IndexStorage (SQLite by default, JSON fallback when native unavailable)
│   └── VectorSearch (brute-force cosine similarity on in-memory vectors)
└── SearchEngine (hybrid: semantic + keyword + rerank + prompt formatting)
```

## Configuration

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `shuncode.indexing.mode` | `"off" \| "local" \| "remote"` | `"local"` | Indexing mode |
| `shuncode.indexing.remoteApiUrl` | string | `""` | Remote API URL |
| `shuncode.indexing.remoteApiKey` | string | `""` | API key |
| `shuncode.indexing.remoteModel` | string | `"text-embedding-3-small"` | Model name |
| `shuncode.indexing.maxFileSize` | number | `102400` | Max file size (bytes) |
| `shuncode.indexing.ignoredPatterns` | string[] | `[node_modules, .git, ...]` | Ignored patterns |

## Index Storage

Stored locally in `~/.shuncode/indexing/{workspace-hash}/`.

Primary backend:
- `index.db` (SQLite) — metadata, chunks, and vectors (BLOB)

Fallback backend (when native SQLite is unavailable):
- `index.json` — metadata
- `chunks.json` — chunk metadata array
- `vectors.bin` — Float32Array vectors

## Embedding Providers

### Local (default)

- **Library:** `@xenova/transformers` (transformers.js)
- **Backend:** WASM (no native modules, works in any environment)
- **Model:** `paraphrase-multilingual-MiniLM-L12-v2` (multilingual, Russian support)
- **Dimensions:** 384
- **Speed:** ~50–100 chunks/sec

### Remote

- **Protocol:** OpenAI Embeddings API (`POST /v1/embeddings`)
- **Compatible with:** OpenAI, Voyage AI, HuggingFace TEI, vLLM, any OpenAI-compatible endpoint
- **Batching:** up to 100 texts per request

## Indexing Pipeline

1. **File traversal** — `FileWalker` recursively walks the workspace, skipping ignored/binary/oversized files
2. **Chunking** — `CodeChunker` uses Tree-sitter for AST-aware chunking, falls back to simple chunker on error
3. **Embedding** — batches of 32 chunks through the selected provider
4. **Storage** — into SQLite (`index.db`) or JSON fallback
5. **FileWatcher** — tracks changes and updates incrementally

## Incremental Updates

- `FileSystemWatcher` monitors create/change/delete events
- Change/create events are debounced (burst-safe)
- On file change: old chunks removed, file re-chunked and re-embedded
- On file delete: chunks removed from index
- Comparison by MD5 hash of file contents

## Search

- **Hybrid retrieval:** semantic (`VectorSearch`) + keyword (`KeywordSearch`)
- **Rerank:** post-retrieval reranking rules for improved precision
- Reduces noise on multilingual queries

## Performance

| Project | Files | Chunks | Indexing (local) | Search |
|---------|-------|--------|-----------------|--------|
| Small (~100 files) | ~100 | ~500 | ~30 sec | <10ms |
| Medium (~2000 files) | ~2000 | ~10K | ~5 min | ~30ms |
| Large (~10000 files) | ~10K | ~50K | ~20 min | ~80ms |

## Agent Integration

The search is exposed as a `codebase_search` tool:
- **Tool ID:** `ShuncodeDefaultTool.CODEBASE_SEARCH`
- **Handler:** `src/core/task/tools/handlers/CodebaseSearchToolHandler.ts`
- Calls `SearchEngine.getContextForPrompt(query)` and returns `<codebase_context>` with relevant chunks

## Commands

| Command | Description |
|---------|-------------|
| `shuncode.indexing.reindex` | Full re-indexing |
| `shuncode.indexing.clear` | Clear entire index |
| `shuncode.indexing.pause` | Pause indexing |
| `shuncode.indexing.resume` | Resume after pause |

## Extending

### Adding a new embedding provider

1. Create a class implementing `EmbeddingProvider` from `src/core/indexing/types.ts`
2. Add a variant in `EmbeddingRouter.ts`
3. Add an option to `shuncode.indexing.mode` enum in `package.json`
4. Add UI in `IndexingSettingsSection.tsx`
