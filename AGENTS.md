# AGENTS.md

## Persistent User Requirements

- When modifying this project, directly update and rebuild the desktop application used by the desktop shortcut, not only the web preview.
- Preserve the user's existing local data, including created dates, todos, details, and related history. Do not add migrations, resets, storage-key changes, seed-data overwrites, or localStorage clearing unless the user explicitly asks for it.
- Before modifying code or solving a requested change, ask clarifying questions first.
- Ask only one question at a time.
- Continue asking follow-up questions until you are at least 95% confident you understand the user's real need and goal.
- Only after that, provide the final plan and implement the change.
- For every code change, debug while modifying: run the relevant app/tests/build checks during the change, and when desktop behavior is involved, verify against the desktop executable rather than relying only on code inspection.
