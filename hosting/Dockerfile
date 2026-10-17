# ResearchRobo 社内ホスト用イメージ（静的配信のみ・ビルド工程なし）。
# ビルドはリポジトリのルートで実行すること（コンテキストがルート全体になる）:
#   docker build -f hosting/Dockerfile -t research-robo .
# 実行:
#   docker run --rm -p 8080:80 research-robo
#
# 非root権限が必要な環境向け: FROM を "nginxinc/nginx-unprivileged:alpine" に差し替え、
# nginx.conf の "listen 80;" を "listen 8080;" に変更し、compose.yaml のポートマップも
# "${RR_PORT:-8080}:8080" に合わせる。
FROM nginx:alpine

LABEL org.opencontainers.image.title="ResearchRobo" \
      org.opencontainers.image.source="https://github.com/KS278810/research-robo" \
      org.opencontainers.image.licenses="CC-BY-4.0"

COPY hosting/nginx.conf /etc/nginx/conf.d/default.conf

# 配信対象を明示的にホワイトリストでCOPYする（COPY . は使わない）。
# dev/ や work2.md、CLAUDE.md（symlink）はこの列挙に無いため、
# .dockerignore が読まれない/効かない環境でも構造的にイメージへ入らない。
RUN rm -f /usr/share/nginx/html/*
COPY index.html viewer.html dispatch.html README.md LICENSE llms.txt robots.txt sitemap.xml /usr/share/nginx/html/
COPY RESEARCH_KIT_v5.2.md RESEARCH_KIT_latest.md RESEARCH_KIT_lite_v1.0.md RESEARCH_KIT_lite_latest.md /usr/share/nginx/html/
COPY benchmark-report-sample.pdf REPORT_STYLE_SYNTHETIC.pdf /usr/share/nginx/html/
COPY assets/ /usr/share/nginx/html/assets/

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null 2>&1 || exit 1
