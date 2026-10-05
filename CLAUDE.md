# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
uv sync                                              # install deps (Python 3.13, auto-downloaded by uv)
./run.sh                                             # start server on http://localhost:8000 (API docs at /docs)
cd backend && uv run uvicorn app:app --reload --port 8000   # manual start — must run from backend/
```

Requires `ANTHROPIC_API_KEY` in `.env` at the repo root (see `.env.example`). There is no test suite or linter configured. `main.py` at the root is an unused uv placeholder; the real entry point is `backend/app.py`.

## Architecture

A RAG chatbot over course transcripts: FastAPI backend + vanilla JS frontend served as static files from the same app.

**Query flow (tool-based retrieval, not retrieve-then-generate):**
`app.py` `/api/query` → `RAGSystem.query()` → `AIGenerator.generate_response()` sends the question to Claude with the `search_course_content` tool. Claude decides whether to search; if it does, `_handle_tool_execution()` runs the tool via `ToolManager`, sends the `tool_result` back, and makes a second Claude call **without tools** — so at most one search round per query. Sources shown in the UI are side-channeled: `CourseSearchTool` stores them in `last_sources`, and `RAGSystem` reads and then resets them through `ToolManager` after the response.

**Two ChromaDB collections** (`vector_store.py`, persisted at `backend/chroma_db`):
- `course_catalog`: one entry per course (title as ID, instructor, links, `lessons_json`). Used to resolve fuzzy course names via semantic search (`_resolve_course_name`).
- `course_content`: text chunks with `course_title` / `lesson_number` metadata, filtered by the resolved title and lesson.

**Ingestion:** on startup, `app.py` loads every `.txt/.pdf/.docx` file in `../docs`. `document_processor.py` expects this exact format: line 1 `Course Title:`, line 2 `Course Link:`, line 3 `Course Instructor:`, then `Lesson N: <title>` markers, each optionally followed by a `Lesson Link:` line. Chunks are sentence-based (`CHUNK_SIZE` / `CHUNK_OVERLAP` in `config.py`) and prefixed with course/lesson context before embedding.

**Adding a tool:** subclass `Tool` in `search_tools.py` (implement `get_tool_definition()` and `execute()`), then register it in `RAGSystem.__init__`.

## Gotchas

- All paths are relative to `backend/` (`../docs`, `../frontend`, `./chroma_db`), so the server must be started from that directory.
- Course title is the unique key, and existing courses are skipped on startup. After editing a doc or changing the chunking or embedding settings, delete `backend/chroma_db` to force a re-ingest.
- The configured model (`config.py`) rejects the `temperature` parameter and may return thinking blocks before text. Use `AIGenerator._extract_text()` instead of `response.content[0].text`.
- Session history is in-memory only (`session_manager.py`), is lost on restart, and is injected into the system prompt as plain text rather than as message turns.
