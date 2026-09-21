# Stage 1: Build
FROM node:22-alpine AS build
WORKDIR /app

# Copiar package definitions del subproyecto
COPY services/student-hub/package*.json ./services/student-hub/

# Instalar dependencias en el subproyecto
RUN cd services/student-hub && npm install --legacy-peer-deps

# Copiar los recursos y código fuente requeridos
COPY data ./data
COPY scripts ./scripts
COPY services/student-hub ./services/student-hub

# Compilar la aplicación Astro SSR
RUN cd services/student-hub && npm run build

# Stage 2: Runtime
FROM node:22-alpine AS runtime
WORKDIR /app/services/student-hub

# Copiar package.json del subproyecto
COPY services/student-hub/package*.json ./

# Instalar dependencias de producción
RUN npm install --omit=dev --legacy-peer-deps

# Copiar el output compilado y los datos de referencia
COPY --from=build /app/services/student-hub/dist ./dist
COPY --from=build /app/data /app/data

# Exponer el puerto del servidor Astro
EXPOSE 80

# Definir variables de entorno de red y ejecutar el servidor standalone
ENV HOST=0.0.0.0
ENV PORT=80
CMD ["node", "dist/server/entry.mjs"]
