FROM node:20-slim
WORKDIR /app
COPY . .
# Cloud Run sets PORT itself; server.js reads process.env.PORT
EXPOSE 8080
CMD ["node", "server.js"]
