FROM node:20-slim
USER node
WORKDIR /home/node/app
COPY --chown=node package.json ./
RUN npm install --omit=dev
COPY --chown=node . .
ENV PORT=7860
EXPOSE 7860
CMD ["node", "server.js"]
