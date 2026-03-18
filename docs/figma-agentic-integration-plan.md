# Agentic Figma Integration Plan

## Goal

Add a new `Figma` tab to Entropic's left navigation that provides:

- a canvas/view for design documents
- a chat-driven, agentic workflow for creating and modifying designs
- a minimal interaction model focused on review, selection, navigation, and approval
- no editor-first chrome carried over from OpenPencil

The target UX is "agentic design workspace", not "OpenPencil embedded inside Entropic".

## Product Direction

### Core principle

Reuse OpenPencil's reusable design model and Figma-style automation surface, but keep Entropic's app shell, routing, chat stack, and runtime ownership.

### Non-goals for v1

- porting OpenPencil's Vue UI into Entropic
- exposing a full manual design editor with toolbars, layers, and property panels
- supporting every OpenPencil feature on day one
- deep Figma cloud sync before local document flow works

## Repo Strategy

### Recommendation

Use a fork or vendored copy of the reusable OpenPencil packages, not a git submodule.

### Why

- Entropic will almost certainly need local changes to the model, tool adapters, persistence, and chat integration.
- A submodule is only attractive if we intend to embed upstream mostly unchanged and update it frequently.
- Fork-or-vendor keeps iteration fast while still preserving a path to upstream sync.

### Proposed approach

1. Start by vendoring or subtree-importing the reusable OpenPencil packages we need.
2. Keep a fork available if we want a clean upstream sync story later.
3. Do not integrate the Vue app itself unless a later phase proves it is cheaper than rebuilding the shell in React.

## Technical Direction

### Reuse from OpenPencil

- `packages/core`
  - design graph
  - `FigmaAPI`
  - tool registry and mutation tools
  - export helpers where useful
- selective AI/tool adapter code patterns
  - not the Vue chat UI
  - not the Vue store directly

### Keep native to Entropic

- routing and left-nav tab structure
- page shell and layout
- chat session model
- Tauri command layer
- local persistence and file handling
- auth/runtime/provider selection

### Translation layer we need

OpenPencil tools expect a live editor store. Entropic needs a React-native document store that can:

- own the active design document
- expose view state like pan/zoom/selection
- produce a `FigmaAPI` instance for tool execution
- emit history snapshots and mutation events for UI updates

## Architecture

### Frontend

Add a new page, tentatively `src/pages/Figma.tsx`, with a two-pane layout:

- center/left: canvas or render view
- right: agent chat and action history

Supporting modules:

- `src/lib/figma/`
  - document store
  - tool bridge
  - serialization helpers
  - view model helpers
- `src/components/figma/`
  - canvas/view
  - history panel or step feed
  - document header/status

### Backend

Add Tauri commands only where local filesystem or native integration is needed:

- save/load design documents
- import/export files
- optional Figma auth or remote API bridging later

Keep the first version mostly frontend-local unless native persistence is required immediately.

## Execution Phases

## Phase 1: Shell And Navigation

Deliverable:

- new `Figma` tab in Entropic sidebar
- dashboard route switch for the page
- placeholder page with agentic layout scaffolding

Tasks:

1. Extend the `Page` type in `src/components/Layout.tsx`.
2. Add a sidebar nav item for `figma`.
3. Extend `renderPage()` in `src/pages/Dashboard.tsx`.
4. Create `src/pages/Figma.tsx` with a split view:
   - design surface placeholder
   - chat placeholder
   - document/session status

Acceptance criteria:

- the tab appears in the left nav
- it routes cleanly
- it preserves Entropic's existing app shell behavior

## Phase 2: Bring In Reusable OpenPencil Core

Deliverable:

- reusable OpenPencil core code available inside Entropic

Tasks:

1. Import or vendor the minimum required OpenPencil packages.
2. Identify package boundaries and build constraints.
3. Make the core compile in Entropic's frontend toolchain.
4. Avoid importing the Vue app and editor-specific shell code.

Open questions:

- whether `packages/core` can be consumed directly as a workspace package
- whether we should copy only specific source files first to reduce integration drag

Acceptance criteria:

- Entropic can instantiate the design graph and `FigmaAPI`
- build remains stable

## Phase 3: React Document Store

Deliverable:

- a React-friendly document state container for design documents

Tasks:

1. Create a document store abstraction for:
   - graph/document
   - current page
   - selection
   - pan/zoom
   - undo/redo history
2. Add helpers to construct a `FigmaAPI` from that store.
3. Add mutation notifications so the canvas and chat update coherently.

Acceptance criteria:

- a design document can be created and mutated in memory
- the UI rerenders after tool execution

## Phase 4: Agent Tool Bridge

Deliverable:

- Entropic chat can operate on the design document through tools

Tasks:

1. Adapt OpenPencil tool definitions into Entropic's chat/runtime flow.
2. Bind tool execution to the React document store.
3. Capture per-step tool activity for the UI.
4. Add safe failure handling for invalid node references and tool errors.

Acceptance criteria:

- the agent can inspect and mutate the design document from chat
- tool results are visible to the user

## Phase 5: Canvas Rendering And Review UX

Deliverable:

- visible design output with lightweight user interaction

Tasks:

1. Render the active document/page on the Figma tab.
2. Support navigation primitives:
   - pan
   - zoom
   - select
3. Add mutation review signals:
   - recent changes
   - current selection
   - optional accept/revert controls if needed

Acceptance criteria:

- the user can see agent edits immediately
- the page feels agentic rather than editor-first

## Phase 6: Persistence And Import/Export

Deliverable:

- local save/load flow for design documents

Tasks:

1. Add Tauri commands if needed for filesystem operations.
2. Define a local document format or use the most suitable OpenPencil serialization path.
3. Add import/export entry points.
4. Persist recent documents and restore state.

Acceptance criteria:

- users can reopen prior work
- document state survives app restarts

## Phase 7: Figma Connectivity

Deliverable:

- targeted Figma interoperability

Possible scope:

- import from Figma-exported assets or files
- export to a Figma-compatible format where feasible
- authenticate with Figma if actual cloud operations are required

Note:

This should follow local-document success. It is not required to prove the agentic workflow.

## First Build Slice

Implement this first:

1. Add `figma` to Entropic page routing.
2. Add a `Figma` nav item.
3. Create a new `Figma` page with a split layout and placeholder components.
4. Keep chat and canvas placeholder-only until the route is stable.

This gives us a clean insertion point before we pull in OpenPencil core code.

## Risks

### Risk: trying to embed OpenPencil's UI wholesale

Impact:

- high integration cost
- React/Vue split ownership
- editor-first UX leaking into Entropic

Mitigation:

- reuse core packages only

### Risk: model/store mismatch

Impact:

- tool execution and rendering can drift apart

Mitigation:

- define Entropic's document store before wiring agent tools deeply

### Risk: tool surface is too broad for v1

Impact:

- long integration time

Mitigation:

- start with a minimal read/create/update subset

## Immediate Next Step

Start Phase 1 now:

- add the `Figma` route
- add the new sidebar tab
- scaffold the new page
