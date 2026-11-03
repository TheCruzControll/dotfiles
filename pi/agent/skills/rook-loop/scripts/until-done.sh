#!/bin/sh
# until-done.sh: the done-check loop. From rook's rig.
#
# The work is done when ./verify exits 0. This script runs the loop and ends it on one of three exits:
#   done           ./verify exits 0                                               exit code 0
#   budget spent   the check sent the agent back LOOP_BUDGET times, still failing  exit code 1
#   you said stop  a file named loop/stop, or Ctrl-C                               exit code 2
# Each exit appends one line to loop/exit.log. Nothing else goes in that file.
#
# ./verify runs outside the harness's prompts, so this script runs it only when a human approved
# that exact file with --approve. A commit is no approval: an agent can commit too. Any other
# ./verify does not run. The check then stops with "human: read ./verify and approve it":
#   not approved   ./verify is new or changed                                     exit code 3
#
# Runner, for a harness with no stop hook (for example codex exec). Start it in your terminal,
# from the project folder, with the path to this script:
#   sh ~/.codex/skills/rook-loop/scripts/until-done.sh "make the parser tests pass"
# It runs the agent with the task, then ./verify. While ./verify fails, it resumes the agent's
# session with the reason and checks again.
#
# Stop hook, for Claude Code (hooks/claude-code-stop.json runs it):
#   sh <this folder>/until-done.sh --stop-hook
# It reads the hook input on stdin and runs ./verify. While ./verify fails, it prints
# {"decision": "block", "reason": "..."} so the agent goes back to work, and keeps the round
# count in loop/rounds.
#
# Approve, for the human, in a terminal, from the project folder:
#   sh <this folder>/until-done.sh --approve
# It prints ./verify, asks for a typed yes on the terminal, and keeps one line per folder in
# ~/.rook-loop/verify.sha256: the hash of ./verify and the folder's path.
#
# Check this script, in a temporary folder:
#   sh <this folder>/until-done.sh --self-test
#
# Settings, from the environment:
#   LOOP_BUDGET  times the check may send the agent back (default 5). A smaller number in
#                loop/budget wins, so a limit the human names in the task holds
#   LOOP_RUN     the first run; the task is added as the last argument (default: codex exec)
#   LOOP_AGAIN   every later run; the reason is added (default: codex exec resume --last)
#   LOOP_RUN and LOOP_AGAIN are split on spaces, so keep quotes out of them.
#
# No ./verify in the folder means no loop: the hook lets the agent stop and writes nothing.
# This script writes only in loop/ and in ~/.rook-loop/. It deletes loop/budget once the loop
# ends. It installs nothing and opens no connection itself; the agent command you choose does
# what that command does.

set -u

budget=${LOOP_BUDGET:-5}
case $budget in '' | *[!0-9]*) budget=5 ;; esac
run=${LOOP_RUN:-codex exec}
again=${LOOP_AGAIN:-codex exec resume --last}
# Outside the project on purpose: an agent that can edit project files could approve its own ./verify.
approvals=${HOME:+$HOME/.rook-loop/verify.sha256}
# An idle count older than this starts over, so a new task gets the whole budget.
idle_minutes=30
ask='human: read ./verify and approve it.'
copy=
trap 'rm -f "${copy:-}"' EXIT

# A limit the human names in the task. The agent writes it to loop/budget. A larger number is ignored.
# The budget is a stop for a loop that goes nowhere, not a wall: the agent can edit files in loop/.
lower_budget() {
  [ -f loop/budget ] || return 0
  asked=$(tr -d ' \r\n' < loop/budget)
  case $asked in '' | *[!0-9]* | ??????*) return 0 ;; esac
  if [ "$asked" -lt "$budget" ]; then budget=$asked; fi
}

# Something planted where loop/ writes: a link, or a plain file named loop.
loop_blocked() {
  [ -L loop ] || { [ -e loop ] && [ ! -d loop ]; } ||
    [ -L loop/rounds ] || [ -L loop/exit.log ] || [ -L loop/stop ] || [ -L loop/budget ]
}

# Stdin becomes a file in loop/. The new file replaces the old one, so a link at that name, hard or
# symbolic, is replaced and never written through.
loop_write() {
  if loop_blocked; then
    echo 'until-done: a link in loop/ is in the way, so nothing was written. Remove it.' >&2
    return 1
  fi
  mkdir -p loop && tmp=$(mktemp loop/.new.XXXXXX) && cat > "$tmp" && mv -f "$tmp" "loop/$1"
}

# One line per stop, and nothing else.
log_exit() {
  { cat loop/exit.log 2>/dev/null; printf 'exit · %s\n' "$1"; } | loop_write exit.log
}

reason() {
  printf './verify exited %s. Run it, fix what it reports, then finish again.' "$1"
}

sha_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum < "$1"
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 < "$1"
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 -r < "$1"
  fi | cut -d' ' -f1
}

# One whole line of the store, this hash and this folder. grep -F would read a line break in the folder's
# name as a second thing to look for, and a copy of another folder's line would then count.
is_approved() {
  # $(pwd -P) removes a line break at the end of the name, so that folder would pass as its twin without one.
  [ "$(pwd -P | wc -l)" -eq 1 ] || return 1
  WANT="$1  $(pwd -P)" awk '($0 "") == ENVIRON["WANT"] { found = 1 } END { exit !found }' < "$approvals"
}

# Copies ./verify outside the project and looks that copy up, so what runs is what was hashed: the file
# cannot change between the two. A link never counts: its target can change while the link stays the same.
take_copy() {
  [ -f ./verify ] && [ ! -L ./verify ] && [ -n "$approvals" ] && [ -f "$approvals" ] || return 1
  copy=$(mktemp "${approvals%/*}/verify.XXXXXX") || return 1
  # cat, not cp: on Windows ./verify can be a verify.exe, and cp would then write <copy>.exe and leave the copy
  # empty. An empty copy never counts: a file that cannot be read gives one too, and it would "pass".
  cat ./verify > "$copy"
  sum=$(sha_of "$copy")
  if [ -s "$copy" ] && [ -n "$sum" ] && is_approved "$sum"; then
    return 0
  fi
  rm -f "$copy"
  copy=
  return 1
}

# The done condition. Its exit code is the answer. It runs in the project folder.
check() {
  if [ -x ./verify ]; then
    chmod +x "$copy"
    "$copy"
  else
    sh "$copy"
  fi
  checked=$?
  rm -f "$copy"
  copy=
  return "$checked"
}

# Sent back once, so the agent tells its human. The next stop goes through: the agent must be able to
# stop and ask.
hook_ask_human() {
  if [ "$1" = yes ] || [ -f loop/rounds ]; then
    rm -f loop/rounds
    log_exit 'not approved · ./verify did not run'
    printf '{"systemMessage": "%s It did not run, so nothing is checked. In your terminal, run until-done.sh --approve."}\n' "$ask"
    exit 0
  fi
  printf '1\n' | loop_write rounds
  printf '{"decision": "block", "reason": "%s It is new or changed, so it did not run. Show the file to your human and ask them to approve it. Do not run --approve yourself. Then stop."}\n' "$ask"
  exit 0
}

stop_hook() {
  input=$(cat)
  cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
  [ -f ./verify ] || exit 0
  if loop_blocked; then
    printf '{"systemMessage": "until-done: a link in loop/ is in the way, so nothing ran. Remove it."}\n'
    exit 0
  fi

  # A retry sent by this hook keeps the count. Any other stop starts a new count only when the count is
  # idle, so a harness that sends no flag still ends at the budget.
  retry=no
  if printf '%s' "$input" | grep -Eq '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
    retry=yes
  elif [ -n "$(find loop/rounds -mmin +"$idle_minutes" 2>/dev/null)" ]; then
    rm -f loop/rounds loop/budget
  fi

  if [ -f loop/stop ]; then
    rm -f loop/stop loop/rounds loop/budget
    log_exit 'you said stop'
    exit 0
  fi

  take_copy || hook_ask_human "$retry"

  # The hook's stdout is read as JSON, so ./verify prints to stderr here.
  check 1>&2
  code=$?
  if [ "$code" -eq 0 ]; then
    rm -f loop/rounds loop/budget
    log_exit 'done · ./verify exited 0'
    exit 0
  fi

  lower_budget
  rounds=$(sed 's/^0*//' loop/rounds 2>/dev/null)
  case $rounds in '' | *[!0-9]* | ??????*) rounds=0 ;; esac
  rounds=$((rounds + 1))
  if [ "$rounds" -gt "$budget" ]; then
    rm -f loop/rounds loop/budget
    log_exit "budget spent · ./verify still fails after $budget rounds"
    printf '{"systemMessage": "Not done: ./verify still fails after %s rounds."}\n' "$budget"
    exit 0
  fi

  printf '%s\n' "$rounds" | loop_write rounds
  printf '{"decision": "block", "reason": "%s Round %s of %s."}\n' "$(reason "$code")" "$rounds" "$budget"
  exit 0
}

runner_refuse() {
  log_exit 'not approved · ./verify did not run'
  echo "until-done: $ask It is new or changed, so it did not run. Run this script with --approve in your terminal." >&2
  exit 3
}

runner_blocked() {
  if loop_blocked; then
    echo 'until-done: a link in loop/ is in the way. Remove it.' >&2
    exit 64
  fi
}

run_loop() {
  task=$1
  if [ ! -f ./verify ]; then
    echo 'until-done: no ./verify in this folder. Write the done condition there first.' >&2
    exit 64
  fi
  runner_blocked
  rm -f loop/stop
  trap 'log_exit "you said stop"; echo "until-done: you said stop" >&2; exit 2' INT
  take_copy || runner_refuse
  rm -f "$copy"
  copy=

  echo "until-done: starting the agent: $run" >&2
  $run "$task"
  if [ "$?" -eq 127 ]; then
    echo "until-done: could not run: $run" >&2
    exit 64
  fi

  rounds=0
  while :; do
    # The agent ran since the last check, and it can edit anything in this folder.
    runner_blocked
    if [ -f loop/stop ]; then
      rm -f loop/stop loop/budget
      log_exit 'you said stop'
      echo 'until-done: you said stop' >&2
      exit 2
    fi

    take_copy || runner_refuse
    check
    code=$?
    if [ "$code" -eq 0 ]; then
      rm -f loop/budget
      log_exit 'done · ./verify exited 0'
      echo 'until-done: done, ./verify exited 0' >&2
      exit 0
    fi

    lower_budget
    rounds=$((rounds + 1))
    if [ "$rounds" -gt "$budget" ]; then
      rm -f loop/budget
      log_exit "budget spent · ./verify still fails after $budget rounds"
      echo "until-done: not done, ./verify still fails after $budget rounds" >&2
      exit 1
    fi

    echo "until-done: ./verify exited $code, sending the agent back (round $rounds of $budget)" >&2
    $again "$(reason "$code")"
  done
}

# One line per folder, so an earlier version is not approved any more.
remember() {
  dir=$(pwd -P)
  next=$(mktemp "${approvals%/*}/next.XXXXXX") || exit 64
  {
    if [ -f "$approvals" ]; then
      DIR=$dir awk 'substr($0, 67) != ENVIRON["DIR"]' "$approvals"
    fi
    printf '%s  %s\n' "$1" "$dir"
  } > "$next"
  mv -f "$next" "$approvals"
}

# The typed yes comes from the terminal, not from stdin, so a plain pipe cannot give it. This is a speed
# bump, not a wall. It runs as your user, so an agent with a free shell can make a terminal to type in
# (script does that) or write the store itself. Nothing in a script can stop that: see the README.
approve() {
  cd "${CLAUDE_PROJECT_DIR:-.}" || exit 64
  if [ ! -f ./verify ] || [ -L ./verify ]; then
    echo 'until-done: no plain ./verify file in this folder, so there is nothing to approve.' >&2
    exit 64
  fi
  if [ -z "$approvals" ]; then
    echo 'until-done: no home folder, so there is nowhere to keep the approval.' >&2
    exit 64
  fi
  if ! (: < /dev/tty) 2>/dev/null; then
    echo 'until-done: no terminal. Your human runs --approve in their own terminal.' >&2
    exit 64
  fi
  # The store keeps one line per folder, so a line break in the name would write a line for another folder.
  if [ "$(pwd -P | wc -l)" -ne 1 ]; then
    echo 'until-done: this folder name holds a line break, so it cannot be approved.' >&2
    exit 64
  fi
  mkdir -p "${approvals%/*}" || exit 64
  copy=$(mktemp "${approvals%/*}/verify.XXXXXX") || exit 64
  cat ./verify > "$copy"
  if [ ! -s "$copy" ]; then
    echo 'until-done: ./verify is empty or cannot be read, so there is nothing to approve.' >&2
    exit 64
  fi
  sum=$(sha_of "$copy")
  if [ -z "$sum" ]; then
    echo 'until-done: this machine has no sha256 tool.' >&2
    exit 64
  fi

  echo '--- ./verify ---'
  cat -v "$copy"
  echo '--- end of ./verify ---'
  # A long file scrolls out of sight, so the human can see that there is more than the screen shows.
  echo "That is $(wc -l < "$copy" | tr -d ' ') lines, $(wc -c < "$copy" | tr -d ' ') bytes."
  printf 'This runs at every stop, outside your harness'\''s prompts. Type yes to approve it: '
  answer=
  read -r answer < /dev/tty
  if [ "$answer" != yes ]; then
    echo 'until-done: not approved.' >&2
    exit 1
  fi

  remember "$sum"
  echo "until-done: approved ./verify ($sum) in $(pwd -P). Any change to the file needs a new approval."
}

# Runs this script against scratch folders, with a scratch home. No network.
self_test() {
  me=$0
  case $me in /* | [A-Za-z]:*) ;; *) me=$(pwd -P)/$me ;; esac
  box=$(mktemp -d) || exit 1
  trap 'rm -rf "$box"' EXIT
  mkdir "$box/home" "$box/home/.rook-loop" "$box/work"
  cd "$box/work" || exit 1
  HOME=$box/home
  export HOME
  approvals=$HOME/.rook-loop/verify.sha256
  unset CLAUDE_PROJECT_DIR LOOP_BUDGET
  fails=0
  hook() { printf '%s' "$1" | sh "$me" --stop-hook 2>/dev/null; }
  # What --approve does after the typed yes: there is no terminal to type in here.
  ok_file() { remember "$(sha_of ./verify)"; }
  want() {
    case $2 in
      *"$3"*) ;;
      *)
        echo "self-test FAIL: $1 (got: $2)" >&2
        fails=$((fails + 1))
        ;;
    esac
  }
  gone() {
    if [ -e "$2" ]; then
      echo "self-test FAIL: $1" >&2
      fails=$((fails + 1))
    fi
  }

  printf '#!/bin/sh\necho ran > ran.txt\nexit 0\n' > verify
  want 'new verify is sent to the human' "$(hook '{}')" "$ask"
  gone 'new verify did not run' ran.txt
  want 'the next stop goes through' "$(hook '{"stop_hook_active":true}')" systemMessage
  gone 'still did not run' ran.txt
  mkdir -p loop
  sha_of ./verify > loop/verify.sha256
  want 'a hash inside the project counts for nothing' "$(hook '{}')" "$ask"
  rm -rf loop
  ok_file
  hook '{}' > /dev/null
  want 'approved verify ran' "$(cat ran.txt 2>/dev/null)" ran
  want 'the private copy is gone' "$(ls "$HOME/.rook-loop")" verify.sha256
  want 'only the store is left' "$(ls "$HOME/.rook-loop" | wc -l | tr -d ' ')" 1
  rm -f ran.txt
  printf '#!/bin/sh\necho ran > ran.txt\nexit 1\n' > verify
  want 'changed verify is sent to the human' "$(hook '{}')" "$ask"
  gone 'changed verify did not run' ran.txt
  rm -rf loop

  ok_file
  LOOP_BUDGET=2
  export LOOP_BUDGET
  for input in '{}' '{ "stop_hook_active" : true }'; do
    rm -rf loop
    hook "$input" > /dev/null
    hook "$input" > /dev/null
    want "budget ends the loop on $input" "$(hook "$input")" 'Not done'
  done
  rm -rf loop
  mkdir loop
  printf '1\n' > loop/budget
  LOOP_BUDGET=5
  hook '{}' > /dev/null
  want 'a human limit in loop/budget lowers the budget' "$(hook '{}')" 'Not done'
  mkdir -p loop
  printf '9\n' > loop/budget
  LOOP_BUDGET=2
  want 'loop/budget cannot raise the budget' "$(hook '{}')" 'of 2'
  printf '09\n' > loop/rounds
  want 'a count with a leading zero still counts' "$(hook '{}')" 'Not done'
  unset LOOP_BUDGET
  rm -rf loop ran.txt

  : > loop
  want 'a plain file named loop stops the check' "$(hook '{}')" 'in the way'
  rm -f loop

  LOOP_RUN=true LOOP_AGAIN=true sh "$me" 'task' > /dev/null 2>&1
  want 'the runner sends back and ends' "$?" 1
  printf '#!/bin/sh\nexit 0\n' > verify
  LOOP_RUN=true LOOP_AGAIN=true sh "$me" 'task' > /dev/null 2>&1
  want 'the runner refuses a changed verify' "$?" 3
  rm -rf loop ran.txt

  printf '#!/bin/sh\nexit 0\n' > verify
  ok_file
  printf '#!/bin/sh\nexit 1\n' > verify
  ok_file
  printf '#!/bin/sh\nexit 0\n' > verify
  want 'an earlier version is not approved any more' "$(hook '{}')" "$ask"
  rm -rf loop
  want 'one line per folder' "$(wc -l < "$approvals" | tr -d ' ')" 1
  mkdir ../other
  (cd ../other && printf 'exit 0\n' > verify && ok_file)
  want 'another folder keeps its line' "$(wc -l < "$approvals" | tr -d ' ')" 2

  # A folder named after a line of the store, on the line after a break: no second thing to look for.
  twin=$(printf '../twin\n%s' "$(tail -n 1 "$approvals")")
  if mkdir -p "$twin" 2>/dev/null; then
    (cd "$twin" && printf '#!/bin/sh\necho ran > ran.txt\n' > verify && hook '{}' > /dev/null)
    gone 'a line break in a folder name approves nothing' "$twin/ran.txt"
  fi
  # A line break at the end of the name: $(pwd -P) would remove it.
  printf '#!/bin/sh\necho ran > ran.txt\n' > verify
  ok_file
  end=$(printf '\nx')
  end=$(pwd -P)${end%x}
  if mkdir "$end" 2>/dev/null; then
    cat verify > "$end/verify"
    (cd "$end" && hook '{}' > /dev/null)
    gone 'a line break at the end of a folder name approves nothing' "$end/ran.txt"
  fi

  # An empty file is never approved: a ./verify that cannot be read reads as empty.
  rm -rf loop ran.txt
  : > verify
  ok_file
  want 'an empty copy counts for nothing' "$(hook '{}')" "$ask"

  if command -v git > /dev/null 2>&1; then
    printf '#!/bin/sh\necho ran > ran.txt\n' > verify
    git init -q .
    git add verify
    git -c user.name=t -c user.email=t@t -c commit.gpgsign=false -c core.hooksPath=/dev/null commit -qm verify
    want 'a commit is no approval' "$(hook '{}')" "$ask"
    gone 'the committed file did not run' ran.txt
  fi

  if [ "$fails" -gt 0 ]; then
    exit 1
  fi
  echo 'self-test ok'
}

usage() {
  cat >&2 <<'EOF'
usage:
  sh until-done.sh "<task>"     run the agent until ./verify exits 0, the budget is spent, or you stop it
  sh until-done.sh --stop-hook  the check behind a Claude Code Stop hook (reads the hook input on stdin)
  sh until-done.sh --approve    for the human, in a terminal: approve this exact ./verify
  sh until-done.sh --self-test  check this script in a temporary folder
EOF
}

case ${1:-} in
  --stop-hook) stop_hook ;;
  --approve) approve ;;
  --self-test) self_test ;;
  '' | -h | --help)
    usage
    exit 64
    ;;
  *) run_loop "$*" ;;
esac
