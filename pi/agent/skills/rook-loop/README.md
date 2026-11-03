# rook-loop

From rook's rig.

Two skills for your own agent setup, and the two scripts they run.

- **recall** asks your past agent sessions: Claude Code and Codex, subagent threads included. It reads this project's sessions, and every project's with `--all`. It prints each match with its file, line, time, role and text, and says `not found` when nothing matches.
- **done-check** makes the work end on a command, not on a feeling. The agent agrees with you what "done" means and writes it as `./verify` first. You read `./verify` and approve it. The agent stops only when `./verify` exits 0, when its budget is spent, or when you say stop. Each stop writes one line to `loop/exit.log`.

## What is in the folder

| File | What it is |
|---|---|
| `SKILL.md` | the entry your harness loads; it points to the two skills |
| `skills/recall/SKILL.md` | rules for asking past sessions, with an example |
| `scripts/recall.mjs` | the search. Node 18 or newer, no dependencies |
| `scripts/recall.selftest.mjs` | the checks behind `recall.mjs --self-test`. Your agent does not run this file |
| `skills/done-check/SKILL.md` | rules for the done condition and the three exits, with an example |
| `hooks/claude-code-stop.json` | a Claude Code Stop hook that sends the agent back while `./verify` fails |
| `scripts/until-done.sh` | the loop: a runner for a harness with no stop hook (for example `codex exec`), and the check the Stop hook runs |

You need Node 18 or newer for recall, and a POSIX shell for `until-done.sh`: macOS, Linux, or Git Bash on Windows. Nothing here downloads or installs anything.

**On Windows:** install Git for Windows. It gives you Git Bash. Claude Code runs its hooks with Git Bash, so the Stop hook also works when you start Claude Code in PowerShell. PowerShell itself has no `sh` command, so run the `sh` commands below in Git Bash. recall needs only Node, so it runs in PowerShell too.

## Approve `./verify`

A hook runs outside your harness's prompts. So the hook and the runner run `./verify` only when you approved that exact file. A commit does not count: an agent can commit too.

In your own terminal, from the project folder, run:

    sh ~/.claude/skills/rook-loop/scripts/until-done.sh --approve

In PowerShell, run:

    & "$env:ProgramFiles\Git\bin\sh.exe" "$HOME/.claude/skills/rook-loop/scripts/until-done.sh" --approve

It prints the file and asks you to type `yes`. It then keeps the file's hash and the folder path in `~/.rook-loop/verify.sha256`, one line per folder. That file is outside the project.

Your answer comes from the terminal, so `--approve` refuses to run with no terminal. This stops a plain command that your agent starts. It is a speed bump, not a wall: the check runs as your user, so an agent with a free shell can also make a terminal with `script`, or write `~/.rook-loop/verify.sha256` itself. The wall is your harness: do not let the agent run any shell command with no prompt. Use a sandbox that keeps its writes inside the project, such as `/sandbox` in Claude Code on macOS or Linux.

Any change to `./verify` needs a new approval, also a change back to an earlier version. Until then, the check says `human: read ./verify and approve it` and does not run the file. A link named `verify` never counts.

The check runs a copy of `./verify` from the project folder. So a script that finds its files through its own path does not work here.

The approval covers the file `./verify` only. If it runs your tests, it also runs what the tests load, and the agent can edit that code. So a hook does not make an unknown repo safe.

## How the loop ends

| Exit | When | Line in `loop/exit.log` | Runner exit code |
|---|---|---|---|
| done | `./verify` exits 0 | `exit · done · ./verify exited 0` | 0 |
| budget spent | the check sent the agent back `LOOP_BUDGET` times (default 5) and `./verify` still fails | `exit · budget spent · ./verify still fails after 5 rounds` | 1 |
| you said stop | `loop/stop` exists, or you press Ctrl-C in the runner | `exit · you said stop` | 2 |
| not approved | `./verify` is new or changed, so it did not run | `exit · not approved · ./verify did not run` | 3 |

The log holds those lines and nothing else. In Claude Code, Esc interrupts at once; the hook does not run then, so no line is written. To stop with a line, tell the agent to stop (its rules have it create `loop/stop`), or run `touch loop/stop` yourself.

The round count starts over when `./verify` passes, when you say stop, when the budget is spent, and after 30 idle minutes.

To change the budget for one task, say it in the task: "stop after 3 tries". The agent writes your number to `loop/budget`. The check uses that number when it is smaller than `LOOP_BUDGET`, so the file can only lower the budget.

While `./verify` is approved, the hook runs it at every stop, also when the agent stops to ask you something. If it asks you a question in the middle of a loop, press Esc and answer.

## Install

Install it in a folder named `rook-loop`, the skill's own name: Claude Code ships its own `/loop` command, and the two names would clash.

### Claude Code

1. Copy the folder to your user's skills:

       mkdir -p ~/.claude/skills && cp -R /path/to/loop ~/.claude/skills/rook-loop

   For recall alone, a copy in `.claude/skills/rook-loop/` in your project also works. The Stop hook needs the copy in your home folder: it runs outside your harness's prompts, so its script must stay out of reach of an agent that edits project files.
2. Optional, for done-check: add the Stop hook to this project. Open `.claude/settings.json`, or `.claude/settings.local.json` to keep it out of commits, and create it if it is missing. Put the `Stop` entry from `hooks/claude-code-stop.json` under `"hooks"`. If the file has no `"hooks"` yet, it can hold the whole content of `hooks/claude-code-stop.json`. To change the budget, start the command with `LOOP_BUDGET=3 `.

   Keep the hook out of `~/.claude/settings.json`. There it would run the `./verify` of every repo you open, also repos you did not write.
3. Run `/hooks` in Claude Code and check that the Stop hook is listed. If it is not, start a new session. Add the hook yourself: in auto mode, Claude Code may refuse to edit its own hooks.

### Cursor

1. Copy the folder to `.cursor/skills/rook-loop/` in your project, or to `~/.cursor/skills/rook-loop/` for every project.
2. For done-check, the agent follows the rules itself: it runs `./verify` before it stops and writes the exit line. Cursor's own stop hook expects a different answer, so `until-done.sh --stop-hook` does not fit it as is.

### Codex

1. Copy the folder to `~/.codex/skills/rook-loop/`. For recall alone, `.codex/skills/rook-loop/` in your project also works.
2. For done-check in the Codex CLI: Codex runs Stop hooks that answer the same way. Put the `Stop` entry from `hooks/claude-code-stop.json` in this project's `.codex/hooks.json`, with the full path to `~/.codex/skills/rook-loop/scripts/until-done.sh` in `command`. Codex runs a hook only after you trust it in `/hooks`, and again after every edit to it. Keep it out of `~/.codex/`, for the same reason as above.
3. For done-check with `codex exec`, start the runner in your terminal, from your project folder:

       sh ~/.codex/skills/rook-loop/scripts/until-done.sh "make the parser tests pass"

   It runs `codex exec` with the task. Then it runs `./verify`. While `./verify` fails, it resumes the same session with `codex exec resume --last` and the reason. Run one loop at a time, because `--last` picks your most recent Codex session.

   By default Codex keeps its own limits, and these limits can stop it from editing files. To let it edit this folder with no prompts, opt in for this run:

       LOOP_RUN="codex exec --full-auto" LOOP_AGAIN="codex exec --full-auto resume --last" sh ~/.codex/skills/rook-loop/scripts/until-done.sh "make the parser tests pass"

   Approve `./verify` before you start. If the agent changes it during the run, the runner stops with exit code 3.
4. If your Codex version wants its flags in another place, or you use another harness with a headless mode and a resume flag, set `LOOP_RUN` (the first run) and `LOOP_AGAIN` (each later run). The task or the reason is added as the last argument.

## Check that it works

Set `PACK` to the folder you installed, for example `PACK=~/.claude/skills/rook-loop`.

1. **Skills.** Start a new session and ask: "Which skills can you use?" `rook-loop` should be in the answer. If it is not, check where your harness version reads skills from.
2. **recall.** Search for words no session holds:

       node "$PACK/scripts/recall.mjs" qqzx-nothing-here; echo "exit $?"

   It prints `not found: "qqzx-nothing-here"`, the scope, one `searched` or `missing` line per place, and `exit 1`. Then search for a word you typed to an agent last week in this project: each match shows `file:line`, `time`, `role` and `text`.
3. **The scripts.** Both have a self-test that uses no network and leaves no file behind:

       node "$PACK/scripts/recall.mjs" --self-test
       sh "$PACK/scripts/until-done.sh" --self-test

   Each prints `self-test ok`.
4. **done-check, with no model.** In an empty scratch folder (`PACK` as an absolute path):

       printf '#!/bin/sh\ntest -f hello.txt\n' > verify
       echo '{}' | sh "$PACK/scripts/until-done.sh" --stop-hook

   It prints `{"decision": "block", "reason": "human: read ./verify and approve it. ...`, and `./verify` does not run. Approve it, and type `yes` when it asks:

       sh "$PACK/scripts/until-done.sh" --approve
       rm loop/rounds
       echo '{}' | sh "$PACK/scripts/until-done.sh" --stop-hook

   It prints `{"decision": "block", "reason": "./verify exited 1. ...` and writes `1` to `loop/rounds`.

       touch hello.txt
       echo '{}' | sh "$PACK/scripts/until-done.sh" --stop-hook
       tail -n 1 loop/exit.log

   It prints nothing, and the log ends with `exit · done · ./verify exited 0`.

       rm hello.txt
       LOOP_RUN=true LOOP_AGAIN=true LOOP_BUDGET=2 sh "$PACK/scripts/until-done.sh" "check"; echo "exit $?"

   `true` stands in for the agent. The runner sends it back twice and ends with `exit 1`, and the log ends with `exit · budget spent · ./verify still fails after 2 rounds`.

       touch loop/stop
       echo '{}' | sh "$PACK/scripts/until-done.sh" --stop-hook
       tail -n 1 loop/exit.log

   The log ends with `exit · you said stop`.

## Safe by design

- recall only reads. By default it reads only this project's session files. `--all` reads every project's, and its rules have the agent ask you first.
- recall hides secrets in common shapes: keys of the usual services (`sk_…`, `ghp_…`, `AKIA…` and others), private key blocks, a value after a name that ends in KEY, TOKEN, SECRET or PASSWORD (in `.env`, YAML, JSON, code, XML, SQL and name and value pairs), flags such as `--password x` and `--client-secret x`, `Cookie` and `Authorization` values, and passwords in URLs. To do that it also hides some text that is no secret, such as the rest of a line after `Authorization:`. It cannot find every secret: a secret in plain words ("my password is x"), a key in an unusual shape, a key split over two lines, and a key in base64, percent or HTML encoding can still reach the agent. The session files on disk stay as they are.
- recall takes local paths only. It refuses a `\\host\share` path, because opening one is a network connection.
- recall prints at most 20 matches, cuts each one to about 2 KB, leaves out thinking unless you ask with `--thinking`, labels tool output, and shows control characters as text.
- `until-done.sh` writes only in `loop/` in the project folder and in `~/.rook-loop/`. It runs your approved `./verify` and the agent command you chose, nothing else.
- The Stop hook runs `./verify` at every stop, once you approved it. Add it only to projects you know, never to your user-wide settings.
- Nothing in the pack installs software or opens a network connection. The agent you run talks to its own model, as it always does.
- `./verify` runs each time the agent tries to stop, so keep it local and safe to repeat: tests, a type check, a build.
- Add `loop/` to `.gitignore` if you do not want it in commits.

## Known limits

- recall does not hide a YAML value with an indent digit, a tag such as `!!binary`, or a blank first line.
- A password with a quote inside a quoted value can show its tail.
- A pair is found by `name`, `key` and `value` keys: backtick quotes, `(` in a name, or `val` and `text` as the value key can show the value.
- `user/password@name` is hidden only as the first argument of an Oracle tool such as `sqlplus`: anywhere else it reads like a package, as `a/b@v1`.
- A short Go login, as `user:password@/db`, stays shown when the password holds `/`, `\`, `;`, `:` or `|`, or has under three characters: those read as paths and code.
- Started outside a git repository, recall counts that folder and its subfolders as this project. In a folder of projects with no `.git`, the default search reads all of them.

## Turn it off

- Delete or rename `./verify`. No `./verify`, no loop.
- Remove the `Stop` entry from the settings file you put it in to remove the hook.
