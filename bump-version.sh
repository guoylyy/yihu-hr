#!/bin/bash
# 改人事考勤的版本号：./bump-version.sh <x.y.z>
# 版本号遵循语义化版本：0.x 是测试版；加功能升次版本号（0.2.0 → 0.3.0），只修问题升修订号（0.2.0 → 0.2.1）。
# 一处改全：backend / frontend 的 package.json 和 package-lock.json（以虎 One「管理 → 应用」的版本列、应用左上角、/health 都读它），
# 并在 CHANGELOG.md 顶上加一节待填。单元测试会校验前后端一致。改完填好 CHANGELOG、提交，再 ./release.sh
set -uo pipefail
cd "$(dirname "$0")" || exit 1
die() { printf '\033[31m✗ %s\033[0m\n' "$*"; exit 1; }

NEW="${1:-}"
echo "$NEW" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$' || die "用法：$0 <x.y.z>，如 $0 0.3.0"
CUR="$(node -p "require('./backend/package.json').version")"
[ "$NEW" = "$CUR" ] && die "当前已经是 $CUR"
node -e "
const [a, b] = [process.argv[1], process.argv[2]].map(v => v.split('.').map(Number))
for (let i = 0; i < 3; i++) { if (a[i] > b[i]) process.exit(0); if (a[i] < b[i]) process.exit(1) }
process.exit(1)" "$NEW" "$CUR" || die "版本号只能往上升（当前 $CUR）"

for d in backend frontend; do (cd "$d" && npm version "$NEW" --no-git-tag-version --allow-same-version >/dev/null) || die "$d 改版本失败"; done
TODAY="$(date +%Y-%m-%d)"
node -e "
const fs = require('fs'); const f = 'CHANGELOG.md'
const s = fs.readFileSync(f, 'utf8'); const i = s.indexOf('\n## ')
const entry = '\n## ' + process.argv[1] + ' · ' + process.argv[2] + '\n\n- （在这里写这个版本的变化：新功能、改动、修复、升级注意事项）\n'
fs.writeFileSync(f, i < 0 ? s + entry : s.slice(0, i) + entry + s.slice(i))" "$NEW" "$TODAY"
printf '\033[32m✓ 版本 %s → %s\033[0m\n  下一步：填好 CHANGELOG.md 里 %s 的说明 → cd backend && npm test → 提交 → ./release.sh\n' "$CUR" "$NEW" "$NEW"
