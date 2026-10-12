#!/usr/bin/env python3
"""desk-look 릴리즈 점검 재료 모으기.

  release_check.py gather [--since VERSION]   릴리즈 노트 구간 + 플러그인 API 타입 diff 요약
  release_check.py mark VERSION              VERSION 까지 봤다고 적는다

타입 스냅숏과 마지막으로 본 버전은 ~/.cache/desk-release-check/ 에 둔다(저장소에 커밋하지 않는다).
엔진은 mod 를 불러올 때마다 그 버전의 타입을 mod 옆에 써 두므로, 이 기계에 남은 것을 모아 버전별로 보관한다.
"""
import difflib
import glob
import json
import os
import re
import subprocess
import sys

HOME = os.path.expanduser('~')
CACHE = os.path.join(HOME, '.cache', 'desk-release-check')
TYPES = os.path.join(CACHE, 'types')
LAST = os.path.join(CACHE, 'last-checked')
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..'))
CANDIDATES = [
    os.path.join(REPO, 'desk-look', '.claude-plugin', 'types', 'claude-code', 'index.d.ts'),
    os.path.join(HOME, '.claude', 'plugins', '**', 'claude-code', 'index.d.ts'),
    os.path.join(HOME, '.claude', 'plugins', '**', 'claude-code.d.ts'),
    os.path.join(HOME, '.claude', 'dev-mods', '**', 'claude-code', 'index.d.ts'),
    '/tmp/claude-*/bundled-skills/*/*/plugin-authoring/types/claude-code.d.ts',
]


def vkey(version):
    return tuple(int(part) for part in re.findall(r'\d+', version))


def api_block(text):
    """파일 모양(분리형 index.d.ts, 합본 claude-code.d.ts)과 상관없이 'claude-code' 모듈 본문만."""
    lines = text.split('\n')
    start = next((i for i, line in enumerate(lines) if line.startswith("declare module 'claude-code' {")), None)
    if start is None:
        return None
    end = next((i for i in range(start + 1, len(lines)) if lines[i] == '}'), len(lines) - 1)
    return '\n'.join(lines[start:end + 1])


def collect():
    """이 기계에 남은 타입 파일을 버전별 스냅숏으로 모은다. 이미 있는 버전은 건드리지 않는다."""
    os.makedirs(TYPES, exist_ok=True)
    for pattern in CANDIDATES:
        for path in glob.glob(pattern, recursive=True, include_hidden=True):
            try:
                text = open(path, encoding='utf-8').read()
            except OSError:
                continue
            match = re.match(r'// Written by Claude Code ([\d.]+)\.', text)
            block = api_block(text)
            if not match or block is None:
                continue
            target = os.path.join(TYPES, f'{match.group(1)}.d.ts')
            if not os.path.exists(target):
                open(target, 'w', encoding='utf-8').write(block)
    return sorted((name[:-5] for name in os.listdir(TYPES) if name.endswith('.d.ts')), key=vkey)


def installed():
    out = subprocess.run(['claude', '--version'], capture_output=True, text=True).stdout
    match = re.search(r'([\d.]+)', out)
    return match.group(1) if match else None


# 터미널 mod 와 상관없는 표면의 항목. 줄 머리 태그로 거른다.
OTHER_SURFACES = re.compile(r'^- (\[(VSCode|JetBrains|Cloud sessions|Claude Tag|Code Review|Desktop)\]|Windows:|macOS:|Self-hosted runner:)')


def changelog():
    out = subprocess.run(
        ['gh', 'api', 'repos/anthropics/claude-code/contents/CHANGELOG.md', '-H', 'Accept: application/vnd.github.raw'],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        return None, out.stderr.strip()
    sections, current = {}, None
    for line in out.stdout.split('\n'):
        heading = re.match(r'^## ([\d.]+)\s*$', line)
        if heading:
            current = heading.group(1)
            sections[current] = []
        elif current:
            sections[current].append(line)
    return {version: '\n'.join(line for line in body if not OTHER_SURFACES.match(line)).strip() for version, body in sections.items()}, None


NAME_PATTERNS = {
    'exported types': re.compile(r"^\s*export type (\w+)", re.M),
    'events / ops (quoted keys)': re.compile(r"^\s*'([a-z]+\.[\w.*]+)'\??:", re.M),
    'ui components': re.compile(r"^      ([A-Z]\w+): \{", re.M),
    '$ members (noun.method)': None,
}


def dollar_members(block):
    """CoreEngineInterface 의 noun: { method: ... } 를 noun.method 로(다른 타입의 같은 들여쓰기 필드는 세지 않는다)."""
    lines = block.split('\n')
    start = next((i for i, line in enumerate(lines) if line.startswith('  export interface CoreEngineInterface {')), None)
    if start is None:
        return set()
    end = next((i for i in range(start + 1, len(lines)) if lines[i] == '  }'), len(lines))
    names, noun = set(), None
    for line in lines[start + 1:end]:
        top = re.match(r'^      ([a-z]\w*): \{$', line)
        if top:
            noun = top.group(1)
            continue
        member = re.match(r'^          ([a-z]\w*)\??: ', line)
        if noun and member:
            names.add(f'{noun}.{member.group(1)}')
    return names


def names_of(kind, block):
    if kind == '$ members (noun.method)':
        return dollar_members(block)
    return set(NAME_PATTERNS[kind].findall(block))


def diff_types(old, new):
    a = open(os.path.join(TYPES, f'{old}.d.ts'), encoding='utf-8').read()
    b = open(os.path.join(TYPES, f'{new}.d.ts'), encoding='utf-8').read()
    summary = {}
    for kind in NAME_PATTERNS:
        before, after = names_of(kind, a), names_of(kind, b)
        summary[kind] = {'added': sorted(after - before), 'removed': sorted(before - after)}
    patch = ''.join(difflib.unified_diff(a.splitlines(True), b.splitlines(True), f'{old}.d.ts', f'{new}.d.ts', n=2))
    path = os.path.join(CACHE, f'api-{old}-to-{new}.diff')
    open(path, 'w', encoding='utf-8').write(patch)
    return summary, path, patch.count('\n')


def gather(since):
    versions = collect()
    current = installed()
    last = since or (open(LAST).read().strip() if os.path.exists(LAST) else None)
    print(f'installed: {current}')
    print(f'last checked: {last or "(none)"}')
    print(f'type snapshots: {", ".join(versions) or "(none)"}')

    notes, error = changelog()
    print('\n# Release notes')
    if notes is None:
        print(f'(could not fetch: {error})')
    else:
        floor = vkey(last) if last else None
        shown = [v for v in notes if (floor is None or vkey(v) > floor) and (current is None or vkey(v) <= vkey(current))]
        if floor is None:
            shown = shown[:3]
            print('(no last-checked version: showing the newest 3)')
        for version in sorted(shown, key=vkey, reverse=True):
            print(f'\n## {version}\n{notes[version]}')

    print('\n# Plugin API diff')
    newest = versions[-1] if versions else None
    older = [v for v in versions if newest and vkey(v) < vkey(newest)]
    base = None
    if last and older:
        at_or_below = [v for v in older if vkey(v) <= vkey(last)]
        base = at_or_below[-1] if at_or_below else older[0]
    elif older:
        base = older[-1]
    if newest is None or base is None:
        print('(need two snapshots: only the current one is on this machine; next run will diff against it)')
        return
    if current and newest != current:
        print(f'(note: newest snapshot is {newest}, installed is {current}; load a mod once on {current} to snapshot it)')
    summary, path, lines = diff_types(base, newest)
    print(f'{base} -> {newest}: {lines} diff lines, full diff at {path}')
    for kind, change in summary.items():
        if change['added'] or change['removed']:
            print(f'\n## {kind}')
            for name in change['added']:
                print(f'+ {name}')
            for name in change['removed']:
                print(f'- {name}')


def main(argv):
    if len(argv) >= 2 and argv[1] == 'mark' and len(argv) == 3:
        os.makedirs(CACHE, exist_ok=True)
        open(LAST, 'w').write(argv[2])
        print(f'marked {argv[2]}')
    elif len(argv) >= 2 and argv[1] == 'gather':
        since = argv[argv.index('--since') + 1] if '--since' in argv else None
        gather(since)
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
