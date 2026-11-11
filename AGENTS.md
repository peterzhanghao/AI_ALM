# Requirement crystallization

When a user asks to finalize a multiround discussion into the requirements plugin, summarize the agreed title, goal, problem and acceptance criteria as labeled text and pipe it to `node packages/dsh-plugin-requirements/bin/crystallize.mjs --root <workspace> --source-session "<session title or ID>" --apply`. Add `--update <REQ-ID>` when the discussion changes an existing requirement. The command verifies code citations and reports when matching evidence is unavailable.
