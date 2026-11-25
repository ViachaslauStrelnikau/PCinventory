# PCinventory

- Read `DESIGN.md` before making changes. Follow the stage gates in `docs/IMPLEMENTATION_PLAN.md` and record unresolved decisions in `docs/decisions.md`.
- After completing each stage in `docs/IMPLEMENTATION_PLAN.md`, run its required checks, record the results, and create a separate local Git commit before starting the next stage.
- Use Russian for user-facing text and English for code, technical identifiers, and code comments.
- Keep the Windows agent compatible with Java 8 bytecode. Verify x86, WOW64, WMI, TLS, and read-only UNC execution on the target Windows matrix before claiming support. Deliver a single self-contained EXE after the packaging PoC.
- Keep the Swing agent to one window and two primary actions. Read hardware after explicit user action. Preserve assignment input across reads and failures. Building, floor and room are required. Preserve string identifiers and leading zeros.
- Collect RAM slots, GPU adapters, and individual physical disks. Preserve unknowns, omit unreliable RAM speed and VRAM, and never invent slot labels. Use only approved devices and synthetic fixtures during development.
- Approve the shared contract after collector research and before Firebase integration or web features. Keep schemas, Java DTOs, TypeScript types, fixtures, and rules aligned.
- Use the approved inbox workflow with mandatory manual review. Use the local emulator for development. Only the agreed restricted Firebase collector login may be embedded in the EXE through GitHub Secrets. Keep other credentials and all tokens out of the repository, logs, and artifacts. Require explicit authorization before changing cloud resources, deploying, or changing billing.
- Keep agent and web builds independent. Pin build dependencies and lock npm dependencies. Run relevant tests and record Windows PoC evidence in `docs/COMPATIBILITY.md`.

## Library and platform documentation

- Use Context7 for library, framework, SDK, API, CLI, and cloud-service questions, including setup, migration, and API-specific debugging. Use local evidence for general programming and work independent of a library or platform API.
- Resolve the official library name with `npx ctx7@latest library <name> "<focused query>"` unless the user provides a Context7 ID. Select the best source by name, relevance, and reputation. Fetch version-specific docs where available with `npx ctx7@latest docs <libraryId> "<focused query>"`.
- Use separate scoped documentation queries for distinct concepts and at most three Context7 commands per question. Keep secrets out of queries and ground the answer in the retrieved docs.
- Run Context7 CLI requests outside the default sandbox. If quota is exhausted, tell the user and suggest `npx ctx7@latest login` or `CONTEXT7_API_KEY`.
