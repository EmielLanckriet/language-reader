#!/data/data/com.termux/files/usr/bin/bash
# Update only the translation supervisor. Does not start a model or change stored media/history.
set -euo pipefail
mkdir -p "$HOME/bin"
target="$HOME/bin/translate.py"
if pgrep -f "python.*$target" >/dev/null; then
  echo 'A translation is running. Stop it in Termux before applying this update.' >&2
  exit 1
fi
staged=$(mktemp "$HOME/bin/translate-update.XXXXXX")
trap 'rm -f "$staged"' EXIT
curl -fsSL https://raw.githubusercontent.com/EmielLanckriet/language-reader/main/scripts/termux/translate.py -o "$staged"
python3 -c 'import ast,sys; ast.parse(open(sys.argv[1]).read())' "$staged"
if [ -f "$target" ]; then cp -p "$target" "$target.before-resource-fix"; fi
mv "$staged" "$target"
echo 'Translation safeguards installed. No models were started.'
