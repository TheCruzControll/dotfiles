# Portable macOS development setup

Pi, Herdr, the active LazyVim configuration, and local custom tools. This checkout
is the source of truth after installation. Edit these copies, not the retired
`~/playground` originals. Legacy root-level Neovim/shell/terminal files are retained
but are **not** installed by the new installer.

## What is included

- `nvim/`: active Neovim configuration and `lazy-lock.json`.
- `herdr/config.toml`: theme, mouse, sound, and Neovim sidebar shortcuts.
- `pi/agent/`: Pi settings, clickable paths, Herdr state reporter, RTK extension,
  design and rook-loop skills, and pi-sidebar extension.
- `packages/`: local source of pi-sidebar. See `PROVENANCE.md`.
- `skills/caveman/`: installed Caveman/Cavecrew and engineering skills, including
  their local changes; upstream Apache-2.0 license is included.
- `personal/mcp.json`: optional personal MCP servers (MEGA, Cloudflare, OpenRouter,
  Superlogical, Neon),
  disabled by default.

These tools can read session content and some actions launch model-backed sessions; review them
and your employer's AI policy before using them at work. A work-safe default is
not a security sandbox or employer approval.

## 1. Install prerequisites explicitly

Do not run dependency installation blindly on an existing machine. These steps
are separate from config linking and may download or execute third-party code.

Recorded baseline: macOS, Node 24.15.0, Pi 1.5.0, Herdr 0.9.5, Neovim 0.9.4.
Use Node 24+ for the combined bundle. The Neovim baseline is old: a newer binary
is a compatibility change to test, not a promise that all old plugins still work.
Herdr must be >=0.8.2.

Install Homebrew using its official instructions if needed. On a fresh Mac:

```sh
brew install node@24 python git gh ripgrep fd tmux
export PATH="$(brew --prefix node@24)/bin:$PATH"
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@1.5.0
```

Install Neovim using an official release appropriate for the baseline above.
`brew install neovim` installs the current release, **not** the recorded version.
Install Herdr from https://github.com/ogulcancelik/herdr using its official
installation instructions; no Herdr installer or binary is vendored here.
Install RTK >=0.23.0 using https://github.com/rtk-ai/rtk if you want its command
compression. A Nerd Font is recommended for Neovim icons.

Ensure `node`, `python3`, `git`, `nvim`, `herdr`, `pi`, `rg`, and `fd` are on PATH
in a new shell and inside Herdr. Configure Node's PATH in your own shell profile;
this installer intentionally does not replace your shell settings.

```sh
git clone https://github.com/TheCruzControll/dotfiles.git ~/dotfiles
cd ~/dotfiles
```

Any checkout location works; keep it in place after linking.

## 2. Preview and link configuration

Close affected Pi/Neovim sessions before applying. **Do not run this from a Pi
session you expect to continue after changing its loaded extensions.**

```sh
python3 scripts/link.py                  # preview only; no changes
python3 scripts/link.py --apply          # backup conflicts, then link
```

Existing destinations (including symlinks) move into
`~/.dotfiles-backups/<timestamp>/`. Every changed path is recorded in that backup's
`manifest.json`. Original custom project directories are not deleted. Repeating
an unchanged installation is a no-op.

By default, an existing MEGA-only MCP config is backed up, not carried into work.
A config mixing MEGA and other servers requires manual separation before applying;
we never silently discard unrelated MCP servers. To opt into the personal server:

```sh
python3 scripts/link.py --personal       # preview
python3 scripts/link.py --apply --personal
```

Authentication is never copied. Sign in only with accounts permitted on that
machine. Model preferences are preserved, but model availability depends on your
account; choose an available model in Pi if the saved default is unavailable.

## 3. Install Pi packages and register Herdr plugins

After linking, explicitly allow the dependency downloads:

```sh
pi update --extensions
herdr plugin install ChmaraX/herdr-nvim
```

Start Pi inside a Herdr pane.

The Neovim sidebar plugin's recorded commit was
`b7c69cab2c1eb8754b505061e942fffc4a557a3e`. The GitHub installer may resolve a newer
commit; for exact reproduction clone that plugin, check out this commit, and use
`herdr plugin link /path/to/herdr-nvim` instead. Keep this clone on the machine.

Pi npm packages and Ponytail are pinned in settings. Local packages need no
`npm install` at runtime: Pi supplies their host imports. Do not copy old
`node_modules` symlinks from another machine.

## 4. Restore Neovim plugins without upgrading them

Before the first launch, bootstrap the recorded lazy.nvim revision (if not already
installed):

```sh
LAZY="${XDG_DATA_HOME:-$HOME/.local/share}/nvim/lazy/lazy.nvim"
# Only clone when this directory does not already exist.
git clone https://github.com/folke/lazy.nvim.git "$LAZY"
git -C "$LAZY" checkout 96584866b9c5e998cbae300594d0ccfd0c464627
```

Launch Neovim and run `:Lazy restore` using the committed lockfile, then `:checkhealth`.
Avoid `:Lazy update` until you deliberately want an upgrade. The Python host is
expected at Neovim's data-directory `python3/bin/python`; if Python plugins need it:

```sh
python3 -m venv "${XDG_DATA_HOME:-$HOME/.local/share}/nvim/python3"
"${XDG_DATA_HOME:-$HOME/.local/share}/nvim/python3/bin/pip" install pynvim
```

Language servers, Rust/TypeScript toolchains and project dependencies remain
project-specific; inspect `:Mason` and health output rather than copying caches.

## Verification

```sh
python3 -m unittest discover -s scripts -p 'test_*.py' -v
```

This tests preview, backups, reruns, rollback, paths with spaces, personal opt-in,
and refusal to overwrite subsequent changes. Package tests live beside each tool.
Plain Node tests need matching Pi host peer modules available in `node_modules`;
Pi normally supplies those only while loading extensions. Development symlinks are
machine-local and ignored by Git.

On another Mac verify: Pi starts without load errors; the preserved skills appear;
Herdr shows agent state; prefix+e opens Neovim; a requested child can launch and
report completion; Neovim opens files and restores plugins. Local automated tests
do not establish that a fresh-Mac interactive installation has passed.

## Rollback

Use the manifest path printed by the installer. Preview before applying:

```sh
python3 scripts/rollback.py ~/.dotfiles-backups/<timestamp>/manifest.json
python3 scripts/rollback.py ~/.dotfiles-backups/<timestamp>/manifest.json --apply
```

Rollback refuses to overwrite a destination changed since installation. It restores
backed-up files/symlinks and removes only links created by that run. It does not
uninstall dependencies, undo plugin registrations, or restore edits made through
links into this repository. Keep Git history and the original project directories.

## Never commit

Credentials, `auth.json`, `mcp-auth.json`, custom model stores, sessions, sockets,
logs, observer history, workflow state, browser profiles, `.env` files and generated
artifacts. Ignore rules reduce accidents; review every commit before publishing.
Personal device configuration does not override an employer's security policies.
