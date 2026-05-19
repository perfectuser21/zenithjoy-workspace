FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/
RUN node -e "require('fs').writeFileSync('/tsconfig.base.json', JSON.stringify({compilerOptions:{strict:true,esModuleInterop:true,skipLibCheck:true,forceConsistentCasingInFileNames:true,resolveJsonModule:true,isolatedModules:true}}))"
RUN npm run build
RUN mkdir -p dist/templates && cp src/templates/*.jsx dist/templates/

FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY --from=builder /app/dist ./dist

EXPOSE 5220

HEALTHCHECK --interval=30s --timeout=3s --start-period=40s \
  CMD node -e "require('http').get('http://localhost:5200/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); })"

CMD ["npm", "start"]
