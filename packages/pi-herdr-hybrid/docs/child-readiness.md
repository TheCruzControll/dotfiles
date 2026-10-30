# Child startup readiness

A successful pane launch is not proof that Pi started. Spawn/resume acknowledgements remain fire-and-forget and report startup pending; `status: started` is retained for ownership/admission compatibility, with `startupState: launching` to distinguish it from readiness.

The child extension writes `<session>.startup` at `session_start` (`ready`, runtime initialized) and `agent_start` (`executing`, an agent run began—not proof of model/API success). Each record carries `PI_SUBAGENT_ID` and `PI_SUBAGENT_SESSION`. The existing completion watcher checks it through its existing filesystem watch/poll, including immediately on arming. Resume uses a new runtime id, rejecting old signals; recovery can reuse the matching durable signal. Signals are retained for recovery, not consumed.

After 30 seconds without confirmation, a single nonterminal startup warning says **unconfirmed**. Trust/startup prompts are possible causes, not a diagnosis. No pane is killed or closed, ownership stays active, and late readiness/completion still works. Matching readiness/execution produces informational messages and updates the widget. Terminal/abort evidence suppresses startup notification, and watcher teardown clears the startup watchdog.

Screenshot scraping was rejected: screen text is ambiguous, theme/version dependent, and cannot reliably correlate a resumed runtime. These lifecycle signals establish runtime initialization, not completion of every other extension's startup handler. Missing or unwritable signals (including older child extensions) yield an unconfirmed warning rather than guessed success. No live-pane testing is required or performed by the unit suite.
