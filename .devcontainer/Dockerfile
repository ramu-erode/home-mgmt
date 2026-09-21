# Base image is known-good; Node is pinned explicitly below rather than taking
# whatever the tag happens to ship.
FROM mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm

# Postgres client pinned to the server major version. Debian bookworm ships
# client 15, and pg_dump refuses to run against a newer server — which would
# only be discovered the first time a backup or restore is attempted.
ARG PG_MAJOR=17
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends "postgresql-client-${PG_MAJOR}" \
 && rm -rf /var/lib/apt/lists/*

# Node 24 (Active LTS), NOT the image's bundled 22.x.
#
# Angular 22's devkit declares engines ^22.22.3 || ^24.15.0 || >=26.0.0. npm
# only warns on a mismatch, but the Angular CLI enforces it at runtime, so an
# unpinned image produces a workspace that installs cleanly and then fails to
# build. Node 22 is in maintenance; 24 is the line to start a long-lived
# project on.
#
# Bump deliberately, and check the Angular devkit's engines field when doing so.
ARG NODE_VERSION=24.21.0
USER node
RUN . "$NVM_DIR/nvm.sh" \
 && nvm install "$NODE_VERSION" \
 && nvm alias default "$NODE_VERSION" \
 && nvm use default \
 && node -v

# Claude Code is installed by the devcontainer feature, not here — see
# devcontainer.json. Keeping it out of the image means it is not pinned to a
# rebuild.

# No global @angular/cli or @nestjs/cli: Nx supplies both through
# `npx nx g @nx/angular:...` / `@nx/nest:...`, and a second, differently
# versioned CLI on PATH is a source of confusing build errors.
