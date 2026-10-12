# Tennis App Backend

Backend REST del Club de Tenis Quintero, construido con NestJS y MongoDB. Administra usuarios, reservas de cancha, rankings, noticias, auditoría e integración con los servicios de correo y Mercado Pago.

## Requisitos

- Node.js `22.19.0`
- npm `10.9.3`
- Una instancia de MongoDB accesible

La versión de Node también está definida en `.nvmrc`:

```bash
nvm use
```

## Instalación

```bash
npm ci
```

## Variables de entorno

Crea un archivo `.env` local. No guardes secretos reales en Git.

```env
# Aplicación
PORT=3500

# MongoDB
MONGODB_URI=mongodb://localhost:27017/Tennis

# JWT
SECRET_KEY=replace-with-a-long-random-secret
TOKEN_EXPIRE_TIME=1h

# Microservicio de Mercado Pago
MP_API_URL=http://localhost:3000/mercadopago

# Microservicio de correo
EMAIL_SERVICE_API_URL=http://localhost:3001/email

# Cloudinary
CLOUDINARY_CLOUD_NAME=replace-me
CLOUDINARY_API_KEY=replace-me
CLOUDINARY_API_SECRET=replace-me

# Noticias; ambos valores son opcionales
NEWS_CTQ_CRON_ENABLED=true
NEWS_CTQ_CRON_SCHEDULE=0 0 6 * * *

# New Relic; opcional
NEW_RELIC_APP_NAME=tennis-app-backend
NEW_RELIC_LICENSE_KEY=replace-me
NEW_RELIC_ENABLED=true
NEW_RELIC_LOG_LEVEL=info
```

`TOKEN_EXPIRE_TIME` usa `1h` por defecto. El cron de noticias queda habilitado por defecto y se ejecuta diariamente a las 06:00 en `America/Santiago`. `NEWS_CTQ_CRON_ENABLED` acepta `true`, `1`, `yes`, `on`, `false`, `0`, `no` u `off`.

## Servicios relacionados

Para probar el flujo completo en local se ejecutan tres aplicaciones:

1. `tennis-app-backend`: puerto `3500` por defecto.
2. `mercadopago-microservice`: configurado mediante `MP_API_URL`.
3. `email-send-microservice`: configurado mediante `EMAIL_SERVICE_API_URL`.

## Ejecución

```bash
# Desarrollo con recarga
npm run start:dev

# Build
npm run build

# Producción local
npm run start:prod
```

Con la aplicación activa:

- Estado: `GET /healthz`
- Swagger: `GET /docs`

## Pruebas

```bash
# Pruebas unitarias
npm test -- --runInBand

# Cobertura
npm run test:cov

# Pruebas e2e
npm run test:e2e
```

## New Relic

El agente se carga al iniciar el backend. Si `NEW_RELIC_LICENSE_KEY` no está configurada o `NEW_RELIC_ENABLED=false`, permanece deshabilitado.

```bash
npm run newrelic:smoke
```

## APIs retiradas

El backend ya no expone:

- Refresh Token; la autenticación utiliza únicamente access tokens.
- Notification/Web Push.
- Exportación XLSX y `filtered-reserves`.

## Despliegue

El proyecto se despliega como aplicación Node.js, por ejemplo mediante el buildpack de Heroku. Los archivos de Docker y Fly.io fueron retirados porque ya no forman parte del flujo de despliegue.
