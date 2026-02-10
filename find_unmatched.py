from pathlib import Path
lines = Path('src/App.tsx').read_text(encoding='utf-8').splitlines()
start = 15762
end = 16871
count = 1
for idx in range(end-1, start-1, -1):
    for ch in reversed(lines[idx]):
        if ch == '{':
            count -= 1
            if count == 0:
                print('Unmatched { likely opened at line', idx+1)
                raise SystemExit
        elif ch == '}':
            count += 1
print('No unmatched { found')
