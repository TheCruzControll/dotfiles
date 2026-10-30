#!/usr/bin/env python3
"""Preview by default; --apply backs up conflicts before linking configuration."""
import argparse
import datetime
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def operations(home, personal=False):
    agent = home / '.pi/agent'
    links = [(ROOT / 'nvim', home / '.config/nvim'),
             (ROOT / 'herdr/config.toml', home / '.config/herdr/config.toml'),
             (ROOT / 'pi/agent/settings.json', agent / 'settings.json')]
    for folder in ['extensions', 'skills']:
        for source in sorted((ROOT / 'pi/agent' / folder).rglob('*')):
            if source.is_file():
                links.append((source, agent / folder / source.relative_to(ROOT / 'pi/agent' / folder)))
    for source in sorted((ROOT / 'packages').iterdir()):
        if source.is_dir():
            links.append((source, agent / 'local-packages' / source.name))
    links.append((ROOT / 'packages/pi-workflow-observer/extension/workflow-observer',
                  agent / 'extensions/workflow-observer'))
    for source in sorted((ROOT / 'skills/caveman').iterdir()):
        if source.is_dir():
            links.append((source, home / '.agents/skills' / source.name))
    if personal:
        links.append((ROOT / 'personal/mcp.json', agent / 'mcp.json'))
    # Retire the old absolute-path shim: the package now loads Conductor directly.
    retire = [agent / 'extensions/automatic-workflows.js']
    # Work-safe mode must not silently preserve the personal MCP connection.
    if not personal and (agent / 'mcp.json').exists():
        config = json.loads((agent / 'mcp.json').read_text())
        servers = config.get('mcpServers', {})
        if 'mega-challenge' in servers:
            if set(servers) != {'mega-challenge'}:
                raise RuntimeError('Mixed MCP configuration: separate personal servers manually before applying.')
            retire.append(agent / 'mcp.json')
    return links, retire


def install(home, apply=False, personal=False):
    home = Path(home).resolve()
    links, retire = operations(home, personal)
    for source, _ in links:
        if not source.exists():
            raise FileNotFoundError(source)
    backup = home / '.dotfiles-backups' / datetime.datetime.now().strftime('%Y%m%dT%H%M%S.%f')
    changes = []
    for source, destination in links + [(None, p) for p in retire]:
        if source is not None and destination.is_symlink() and destination.resolve() == source.resolve():
            continue
        if source is None and not os.path.lexists(destination):
            continue
        saved = backup / destination.relative_to(home)
        print(f'{"LINK " + str(source) if source else "RETIRE"} -> {destination}')
        if os.path.lexists(destination):
            print(f'  BACKUP -> {saved}')
        if apply:
            if os.path.lexists(destination):
                saved.parent.mkdir(parents=True, exist_ok=True)
                destination.rename(saved)
            changes.append({'destination': str(destination), 'source': str(source) if source else None,
                            'backup': str(saved) if os.path.lexists(saved) else None})
            # Journal before linking so an interrupted run still has rollback instructions.
            backup.mkdir(parents=True, exist_ok=True, mode=0o700)
            os.chmod(backup, 0o700)
            journal = backup / 'manifest.json'
            pending = backup / 'manifest.tmp'
            pending.write_text(json.dumps(changes, indent=2) + '\n')
            pending.replace(journal)
            if source is not None:
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.symlink_to(source, target_is_directory=source.is_dir())
    if apply and changes:
        print(f'Rollback manifest: {backup / "manifest.json"}')
    return changes


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--personal', action='store_true', help='Opt in to the personal MEGA MCP connection')
    args = parser.parse_args()
    install(Path.home(), args.apply, args.personal)
