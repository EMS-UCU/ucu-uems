from pathlib import Path
lines = Path('src/App.tsx').read_text(encoding='utf-8').splitlines()
start = 15762
end = 16871
count = 0
min_count = 0
for idx in range(start, end):
    line = lines[idx]
    for ch in line:
        if ch == '(':
            count += 1
        elif ch == ')':
            count -= 1
        min_count = min(min_count, count)
print('net', count, 'min', min_count)
