#!/usr/bin/env bash
# ResearchRoboの配信（serve.py・Docker/nginx・GHES/GitLab Pages・公開サイトいずれでも）が
# 正しく動いているかを外形からcurlで確認する。
# 使い方: bash hosting/check.sh [BASE_URL]
#   例:   bash hosting/check.sh http://localhost:8080/
#         bash hosting/check.sh https://ks278810.github.io/research-robo/
set -uo pipefail

BASE="${1:-http://localhost:8080/}"
case "$BASE" in */) ;; *) BASE="$BASE/" ;; esac

pass=0
fail=0

# 期待するHTTPステータス（+任意でContent-Typeの部分一致）を確認する
expect() {
  local path="$1" want_code="$2" want_ct="${3:-}"
  local out code ct
  out="$(curl -s -o /dev/null -D - "${BASE}${path}" 2>/dev/null)"
  code="$(printf '%s' "$out" | awk 'NR==1{print $2}')"
  ct="$(printf '%s' "$out" | tr -d '\r' | awk -F': ' 'tolower($1)=="content-type"{print $2}')"
  if [ "$code" != "$want_code" ]; then
    echo "FAIL: ${path} -> status $code (期待 $want_code)"
    fail=$((fail + 1))
    return
  fi
  if [ -n "$want_ct" ] && [[ "$ct" != *"$want_ct"* ]]; then
    echo "FAIL: ${path} -> content-type '$ct'（期待: '$want_ct' を含む）"
    fail=$((fail + 1))
    return
  fi
  echo "OK:   ${path} -> $code${ct:+ ($ct)}"
  pass=$((pass + 1))
}

echo "=== ${BASE} を確認 ==="

expect "" 200 "text/html"
expect "index.html" 200 "text/html"
expect "viewer.html" 200 "text/html"
expect "dispatch.html" 200 "text/html"
expect "RESEARCH_KIT_latest.md" 200 "text/markdown"
expect "RESEARCH_KIT_lite_latest.md" 200 "text/markdown"
expect "assets/js/rr-checks.js" 200 "javascript"
expect "assets/js/rr-report-css.js" 200 ""
expect "assets/report/page-01.webp" 200 "image/webp"
expect "assets/images/logo-mark.svg" 200 "image/svg+xml"
expect "assets/images/favicon.ico" 200 ""
expect "benchmark-report-sample.pdf" 200 "application/pdf"
expect "LICENSE" 200 ""

expect "dev/CLAUDE.md" 404
expect "CLAUDE.md" 404
expect "work2.md" 404
expect ".git/HEAD" 404
expect "assets/" 404

# .gitignoreはGitHub Pagesでは200になる（Pagesはドットファイルを隠さない。中身に
# 秘匿情報は無いので実害は無い）。社内配信（serve.py・nginx.conf）は404にする設計だが、
# ホスト先によって正しい挙動が違うため、ここでは失敗扱いにせず参考情報として出す
_gi_code="$(curl -s -o /dev/null -w '%{http_code}' "${BASE}.gitignore" 2>/dev/null)"
echo "INFO: .gitignore -> ${_gi_code}（社内配信=404を推奨、GitHub Pages=200は既知で問題なし）"
# /healthz は nginx（Docker）のみが持つ。serve.py・GitHub Pages では404になるのが正しいので参考情報として出す
_hz_code="$(curl -s -o /dev/null -w '%{http_code}' "${BASE}healthz" 2>/dev/null)"
echo "INFO: healthz -> ${_hz_code}（Docker/nginx=200を期待、serve.py・GitHub Pagesの404は正常）"

echo
echo "=== KITミラーのバイト一致 ==="
full_a="$(curl -fsSL "${BASE}RESEARCH_KIT_v5.2.md" 2>/dev/null | md5sum | cut -d' ' -f1)"
full_b="$(curl -fsSL "${BASE}RESEARCH_KIT_latest.md" 2>/dev/null | md5sum | cut -d' ' -f1)"
if [ -n "$full_a" ] && [ "$full_a" = "$full_b" ]; then
  echo "OK:   RESEARCH_KIT_v5.2.md == RESEARCH_KIT_latest.md"
  pass=$((pass + 1))
else
  echo "FAIL: RESEARCH_KIT_v5.2.md != RESEARCH_KIT_latest.md（md5: $full_a / $full_b）"
  fail=$((fail + 1))
fi
lite_a="$(curl -fsSL "${BASE}RESEARCH_KIT_lite_v1.0.md" 2>/dev/null | md5sum | cut -d' ' -f1)"
lite_b="$(curl -fsSL "${BASE}RESEARCH_KIT_lite_latest.md" 2>/dev/null | md5sum | cut -d' ' -f1)"
if [ -n "$lite_a" ] && [ "$lite_a" = "$lite_b" ]; then
  echo "OK:   RESEARCH_KIT_lite_v1.0.md == RESEARCH_KIT_lite_latest.md"
  pass=$((pass + 1))
else
  echo "FAIL: RESEARCH_KIT_lite_v1.0.md != RESEARCH_KIT_lite_latest.md（md5: $lite_a / $lite_b）"
  fail=$((fail + 1))
fi

echo
echo "=== 末尾スラッシュ無しURLの挙動（301推奨・200も許容） ==="
root_noslash="${BASE%/}"
code="$(curl -s -o /dev/null -w '%{http_code}' "$root_noslash" 2>/dev/null)"
if [ "$code" = "301" ] || [ "$code" = "200" ] || [ "$code" = "308" ]; then
  echo "OK:   ${root_noslash} -> $code"
  pass=$((pass + 1))
else
  echo "FAIL: ${root_noslash} -> $code（301/308/200のいずれでもない）"
  fail=$((fail + 1))
fi

# 2026-10-14(Docker実機検証で発見): nginx が /assets → /assets/ の301を「listenポート(80)」の絶対URLで返し、
# 公開ポートを変えた運用でホスト:ポートが落ちていた。ディレクトリ名（末尾スラッシュ無し）がリダイレクトされるなら、
# Location が今アクセスしている origin（スキーム://ホスト[:ポート]）から始まるか、相対であることを要求する
echo
echo "=== ディレクトリリダイレクトの Location が元のホスト:ポートを保つ ==="
origin="$(printf '%s' "$BASE" | sed -E 's#^(https?://[^/]+).*#\1#')"
loc_code="$(curl -s -o /dev/null -w '%{http_code}' "${BASE}assets" 2>/dev/null)"
# 生の Location ヘッダを読む（curl の %{redirect_url} は相対Locationを絶対URLに解決してしまい、検査にならない）
loc="$(curl -s -o /dev/null -D - "${BASE}assets" 2>/dev/null | tr -d '\r' | awk 'tolower($1)=="location:"{print $2; exit}')"
case "$loc_code" in
  301|302|307|308)
    if [ -z "$loc" ] || case "$loc" in /*|"$origin"/*) true;; *) false;; esac; then
      echo "OK:   ${BASE}assets -> $loc_code Location=${loc:-（なし）}"
      pass=$((pass + 1))
    else
      echo "FAIL: ${BASE}assets -> $loc_code Location=$loc（アクセス中の $origin ではない）"
      fail=$((fail + 1))
    fi ;;
  *) echo "INFO: ${BASE}assets -> $loc_code（リダイレクトしない配信。検査対象外）" ;;
esac

echo
echo "PASS $pass / FAIL $fail"
[ "$fail" -eq 0 ]
