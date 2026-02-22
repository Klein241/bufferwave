FROM node:20-alpine

WORKDIR /app

# Installer les dépendances système
RUN apk add --no-cache \
    wireguard-tools \
    iptables \
    curl

# Copier les fichiers
COPY server/ ./server/
COPY package.json ./

# Installer les dépendances Node
RUN npm install --production

# Créer les dossiers de données
RUN mkdir -p /data/dtn /data/cache

EXPOSE 3000
EXPOSE 51820/udp

CMD ["node", "server/index.js"]
