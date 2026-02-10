from pathlib import Path
lines = Path('src/App.tsx').read_text(encoding='utf-8').splitlines()
start = 15762
end = 16871
parens = 0
for idx in range(start, end):
    for ch in lines[idx]:
        if ch == '(':
            parens += 1
        elif ch == ')':
            parens -= 1
print('paren net', parens)
curlies = 0
for idx in range(start, end):
    for ch in lines[idx]:
        if ch == '{':
            curlies += 1
        elif ch == '}':
            curlies -= 1
print('curlies net', curlies)
