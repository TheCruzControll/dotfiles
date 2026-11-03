---
name: done-check
description: Use at the start of any task that should end only when a check passes. Agree with your human what done means as a command, write it as ./verify, then stop only on one of three exits.
---

# done-check

You do not decide when the work is done. A command does. Agree it with your human, write it as `./verify` in the project folder, work until it exits 0, and end on one of the exits below. Each stop appends one line to `loop/exit.log`, and that line is all the log holds.

| Exit | When | Line in `loop/exit.log` |
|---|---|---|
| done | `./verify` exits 0 | `exit · done · ./verify exited 0` |
| budget spent | the check sent you back `LOOP_BUDGET` times (default 5) and `./verify` still fails | `exit · budget spent · ./verify still fails after 5 rounds` |
| you said stop | your human said stop: `loop/stop` exists, or they pressed Ctrl-C in the runner | `exit · you said stop` |
| not approved | your human has not approved this `./verify`, so it did not run | `exit · not approved · ./verify did not run` |

## Rules

1. **Agree the done condition before the work.** Say the command to your human first: "Done means `<command>` exits 0. Is that right?" If they say no, use the command they describe instead. Only then write it to `./verify`, a shell script (`chmod +x verify`). If `./verify` already exists, read it and ask before you change it. Check: they said yes before you wrote `./verify`.
2. **Get `./verify` approved.** The hook and the runner run `./verify` outside your harness's prompts, so they run only a file your human approved. Show them the whole file and ask: "Please read `./verify`. If it is safe, run `sh <pack folder>/scripts/until-done.sh --approve` in your own terminal." With neither the hook nor the runner wired, skip the terminal step, but still show the whole `./verify` and ask. A commit does not count. Until they approve it, the check says `human: read ./verify and approve it` and does not run it. Never run `--approve` yourself. After any change to `./verify`, ask again. Check: your human approved this version of the file.
3. **Keep to the limit your human names.** If they say "stop after 3 tries", run `mkdir -p loop && echo 3 > loop/budget` before the work. The hook and the runner then use that number when it is smaller than `LOOP_BUDGET`. It can only lower the budget. Check: `loop/budget` holds their number.
4. **Keep it safe to run again and again.** `./verify` runs each time you try to stop. It reads and tests on this machine, inside this folder: tests, a type check, a build. It never deploys, sends anything or changes files outside the folder. Check: two runs in a row give the same exit code and change no tracked file.
5. **Run it before you stop.** Exit 0 means done. Any other code means keep working on what it reports. Check: the exit code of your last `./verify` run.
6. **Change the work, not the check.** Never edit `./verify` to make it pass or to skip a part that fails. A new done condition needs your human's yes. Check: `git diff -- verify` is empty, or your human agreed to the change.
7. **Your human's stop wins at once.** When they say stop, end your turn. With the hook or the runner wired, first run `mkdir -p loop && touch loop/stop`, so the exit is logged. Never create `loop/stop` for any other reason. Check: your human said stop in this session.
8. **Budget spent is not done.** The hook's reason counts the rounds. After the last one (`Round 5 of 5` by default), a failing check lets you stop. With neither wired, count failing rounds yourself and stop after 5, or after the number your human named. If your own `./verify` run still fails then, tell your human plainly: not done, `./verify` still fails, and what it reports now. Check: your last message does not call the work done.
9. **Log the exit and nothing else.** The hook or the runner appends the line for you. With neither wired, append it yourself when you stop, with a line from the table above, for example `mkdir -p loop && echo 'exit · done · ./verify exited 0' >> loop/exit.log`. Check: `tail -n 1 loop/exit.log` shows this stop's exit.

## How it is wired

The scripts sit in `scripts/` in the pack folder, two levels above this file.

- **Claude Code:** `hooks/claude-code-stop.json` is a Stop hook. Each time you try to stop, it runs `scripts/until-done.sh --stop-hook`, which runs `./verify` if your human approved it. While it fails, the hook sends you back with the reason and counts the round in `loop/rounds`. Your human adds the hook to this project's settings, and `/hooks` lists it once it is active.
- **No stop hook, for example `codex exec`:** from the project folder, your human starts `sh <pack folder>/scripts/until-done.sh "<task>"` in their terminal. It runs you with the task, runs `./verify`, and resumes your session with the reason while it fails. If `./verify` changes during the run, the runner stops.
- **No `./verify` in the folder means no loop.** The hook lets you stop and writes nothing.
- **Not approved means not checked.** The hook sends you back once with `human: read ./verify and approve it`. Show your human the file, ask, and stop. The next stop goes through and the work is not done.
- **Once `./verify` is approved, every stop runs it,** a stop to ask your human something included. While it fails, the hook sends you back. So ask what you need before you write it.

## Example

Your human: "The CSV parser splits a quoted comma into two fields. Fix it." The repo has a case for it in `test/parser.test.mjs`.

1. Agree the check, then write it. "Done means `node --test test/parser.test.mjs` exits 0. Is that right?" Your human: "Yes." Write `./verify`:

       #!/bin/sh
       # done when: the parser tests pass
       node --test test/parser.test.mjs

2. Show the file and ask your human to approve it. They read it and run `--approve` in their own terminal.
3. Run `./verify`. It fails on `keeps a quoted comma inside one field`. Fix `src/parser.mjs`.
4. Try to stop. The hook runs `./verify`, which now fails on an escaped quote, and sends you back: `./verify exited 1. Run it, fix what it reports, then finish again. Round 1 of 5.`
5. Run `./verify`, fix the escaped quote, and run it again: exit 0. Stop. The hook appends `exit · done · ./verify exited 0`.
6. Tell your human: "Done: `./verify` exits 0 and the parser tests pass."

In other stacks the command is, for example, `pytest -q tests/test_parser.py`, `go test ./parser/` or `cargo test parser`.

## Done looks like

- `./verify` holds the done condition your human agreed to, and they approved this version.
- Its last run exited 0. Or the last line of `loop/exit.log` says `budget spent` or `you said stop`, and your human knows the work is not done.
- `loop/exit.log` has one new line for this stop.
