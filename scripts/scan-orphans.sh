#!/bin/bash
# Scan for unreferenced modules in the rebuilt frontend src/
cd /home/z/my-project/alnokhba-push/frontend || exit 1
echo "--- scanning src/ for modules with zero inbound references ---"
find src -type f \( -name "*.jsx" -o -name "*.js" -o -name "*.ts" \) | sort | while read -r f; do
  base=$(basename "$f")
  name="${base%.*}"
  # search all references to this module name in src + index.html, excluding the file itself
  refs=$(rg -l "$name" src index.html --no-messages 2>/dev/null | grep -v "^$f$" | wc -l)
  if [ "$refs" -eq 0 ]; then
    echo "ORPHAN? $f"
  fi
done
echo "--- done ---"
