FROM node:24-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/app/data

WORKDIR /app

COPY --chown=node:node backend/package.json ./package.json
COPY --chown=node:node backend/src ./src
COPY --chown=node:node public/data ./data

USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "src/server.mjs"]
