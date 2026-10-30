#!/usr/bin/env python3
"""Restore a link.py backup manifest; refuse to overwrite subsequent changes."""
import argparse
import json
import os
from pathlib import Path


def rollback(manifest, apply=False):
    changes = json.loads(Path(manifest).read_text())
    for entry in reversed(changes):
        destination = Path(entry['destination'])
        source = entry['source']
        if os.path.lexists(destination):
            if source is None or not destination.is_symlink() or os.readlink(destination) != source:
                raise RuntimeError(f'Refusing to overwrite a changed destination: {destination}')
        saved = Path(entry['backup']) if entry['backup'] else None
        if saved and not os.path.lexists(saved):
            raise FileNotFoundError(saved)
    for entry in reversed(changes):
        destination = Path(entry['destination'])
        print(f'RESTORE {destination}')
        if apply:
            if destination.is_symlink():
                destination.unlink()
            if entry['backup']:
                Path(entry['backup']).rename(destination)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    rollback(args.manifest, args.apply)
