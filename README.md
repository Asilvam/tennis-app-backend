# Tennis App Backend

Backend principal del Club de Tenis Quintero. Está construido con NestJS y MongoDB y administra autenticación, socios, canchas, reservas, ranking, pagos, auditoría, correo transaccional, imágenes y noticias.

## Requisitos

- Node.js `22.19.0`
- npm `10.9.3`
- MongoDB local o MongoDB Atlas
- `mercadopago-microservice` para procesar pagos
- `email-send-microservice` para entregar correos
- Cloudinary si se utilizará la carga de imágenes de perfil

Puedes activar la versión recomendada de Node definida en `.nvmrc` con:

```bash
nvm use
node --version
npm --version
```

## Servicios y puertos locales

| Servicio          | Directorio                 | Puerto recomendado | URL base                            |
| ----------------- | -------------------------- | -----------------: | ----------------------------------- |
| Mercado Pago      | `mercadopago-microservice` |             `3000` | `http://localhost:3000/mercadopago` |
| Correo            | `email-send-microservice`  |             `3001` | `http://localhost:3001/email`       |
| Backend principal | `tennis-app-backend`       |             `3500` | `http://localhost:3500`             |

Cada servicio se instala y ejecuta en una terminal independiente. No se utiliza Docker ni Fly.io en este repositorio.

## Instalación local completa

### 1. Servicio de correo

```bash
cd ../email-send-microservice
npm ci
cp .env.example .env
npm run start:dev
```

Su `INTERNAL_API_KEY` debe coincidir con `EMAIL_SERVICE_API_KEY` del backend principal.

### 2. Microservicio de Mercado Pago

```bash
cd ../mercadopago-microservice
npm ci
cp .env.example .env
npm run start:dev
```

Su `INTERNAL_API_KEY` debe coincidir con `INTERNAL_API_KEY` del backend principal. Para recibir webhooks reales, `NOTIFICATION_URL` debe ser una URL HTTPS pública que apunte a `/mercadopago/webhook`; `localhost` no es accesible desde Mercado Pago.

### 3. Backend principal

```bash
cd ../tennis-app-backend
npm ci
npm run start:dev
```

El backend escucha en `http://localhost:3500` cuando `PORT` no está definido.

## Variables de entorno del backend

Crea manualmente un archivo `.env` en la raíz de `tennis-app-backend`. No guardes secretos reales en Git.

```dotenv
# Aplicación
PORT=3500

# MongoDB
MONGODB_URI=mongodb+srv://user:password@cluster.example.mongodb.net/tennis

# JWT
SECRET_KEY=replace-with-a-long-random-secret
TOKEN_EXPIRE_TIME=1h

# Mercado Pago
MP_API_URL=http://localhost:3000/mercadopago
INTERNAL_API_KEY=replace-with-the-same-key-used-by-mercadopago-microservice

# Tarifas opcionales en CLP
MP_NIGHT_AMOUNT=4000
MP_VISIT_AMOUNT=7000
MP_NIGHT_VISIT_AMOUNT=11000

# Correo
EMAIL_SERVICE_API_URL=http://localhost:3001/email
EMAIL_SERVICE_API_KEY=replace-with-the-email-service-internal-api-key

# Cloudinary
CLOUDINARY_CLOUD_NAME=replace-with-cloud-name
CLOUDINARY_API_KEY=replace-with-cloudinary-key
CLOUDINARY_API_SECRET=replace-with-cloudinary-secret

# Noticias: ambos valores son opcionales
NEWS_CTQ_CRON_ENABLED=true
NEWS_CTQ_CRON_SCHEDULE=0 0 6 * * *

# New Relic: opcional
NEW_RELIC_APP_NAME=tennis-app-backend
NEW_RELIC_LICENSE_KEY=replace-with-license-key
NEW_RELIC_ENABLED=true
NEW_RELIC_LOG_LEVEL=info
```

Notas:

- `TOKEN_EXPIRE_TIME` usa `1h` por defecto.
- `NEWS_CTQ_CRON_ENABLED` usa `true` por defecto.
- `NEWS_CTQ_CRON_SCHEDULE` usa las 06:00 diariamente por defecto.
- Las tarifas tienen valores predeterminados y solo deben declararse para sobrescribirlos.
- New Relic queda deshabilitado si no existe `NEW_RELIC_LICENSE_KEY` o si `NEW_RELIC_ENABLED=false`.
- El backend no utiliza refresh tokens.

## Variables compartidas

Las claves internas cumplen propósitos distintos:

| Consumidor                       | Variable local          | Debe coincidir con                               |
| -------------------------------- | ----------------------- | ------------------------------------------------ |
| Backend principal ↔ Mercado Pago | `INTERNAL_API_KEY`      | `INTERNAL_API_KEY` de `mercadopago-microservice` |
| Backend principal → correo       | `EMAIL_SERVICE_API_KEY` | `INTERNAL_API_KEY` de `email-send-microservice`  |

No expongas estas claves al frontend.

## Flujo de pagos de reservas

Antes de mostrar el importe, el frontend consulta `GET /mp/rates`. Devuelve `currency: "CLP"`, `nightAmount`, `visitAmount` y `nightVisitAmount`, calculados con las mismas variables `MP_*_AMOUNT` y valores predeterminados que se utilizan para cobrar. No devuelve claves internas ni crea una reserva o preferencia. La respuesta no se almacena en caché; una tarifa inválida devuelve `503`.

1. El frontend solicita al backend crear una preferencia mediante `POST /mp/init-point`.
2. El backend recupera la reserva persistida y calcula el importe; no confía en un importe enviado por el navegador.
3. El backend llama a `POST /mercadopago/create-preference` en el microservicio.
4. Mercado Pago envía el webhook firmado al microservicio.
5. El microservicio persiste el evento antes de responder y lo procesa mediante reintentos con backoff.
6. El microservicio llama al backend para actualizar la reserva y enviar el correo.
7. El backend utiliza `Idempotency-Key` y persistencia MongoDB para evitar actualizaciones y correos duplicados.

Los callbacks internos protegidos son:

- `POST /court-reserve/UpdateStateReserve/:idCourtReserve`
- `POST /court-reserve/emailconfirmation`

## Persistencia e idempotencia

El microservicio de Mercado Pago mantiene:

- `mp_webhook_inbox`: recepción durable con estados `PENDING`, `PROCESSING`, `PROCESSED` y `FAILED`.
- `mp_webhook_effects`: deduplicación de efectos y reintentos.
- `mp_logs`: auditoría append-only con retención configurable.

El backend principal mantiene una segunda barrera de idempotencia para los callbacks en `payment_callback_effects` y registra eventos de negocio en el audit log.

## Usuarios y estado de pago

El acceso depende de dos propiedades del socio:

- `statePlayer=false`: bloqueo administrativo.
- `updatePayment=false`: bloqueo por pago pendiente.

El login rechaza cualquiera de esos estados.

## Correo

Este backend no se conecta directamente a SMTP. Genera las plantillas HTML y envía la solicitud autenticada a:

```text
POST {EMAIL_SERVICE_API_URL}/send
```

La configuración SMTP (`MAIL_HOST`, `MAIL_USER`, `MAIL_PASSWORD`, entre otras) pertenece exclusivamente a `email-send-microservice`.

## Noticias programadas

`NEWS_CTQ_CRON_ENABLED` controla si el proceso automático se registra al iniciar la aplicación. Acepta `true`, `1`, `yes` o `on` para habilitarlo. `NEWS_CTQ_CRON_SCHEDULE` utiliza una expresión cron de seis campos compatible con NestJS Schedule.

## Ejecución y validación

```bash
# Desarrollo
npm run start:dev

# Compilación
npm run build

# Producción, después de compilar
npm run start:prod

# Pruebas unitarias
npm test

# Cobertura
npm run test:cov

# Pruebas end-to-end
npm run test:e2e
```

El health check del backend está disponible en `GET /healthz` y Swagger en `GET /docs`.

Para comprobar New Relic sin depender de MongoDB:

```bash
npm run newrelic:smoke
```

## Integraciones eliminadas

Este backend ya no incluye:

- Web Push/notifications.
- WhatsApp Web.
- Exportaciones XLSX de reservas.
- Refresh tokens.
- Configuración de Fly.io.

## Seguridad operativa

- Usa secretos largos y distintos por ambiente.
- No publiques `.env`, credenciales de MongoDB, tokens de Mercado Pago ni claves de Cloudinary.
- Valida la firma de los webhooks de Mercado Pago.
- Rota cualquier secreto que haya sido compartido o publicado accidentalmente.
- Conserva la persistencia de auditoría y efectos al desplegar nuevas versiones.

## Licencia

Proyecto privado (`UNLICENSED`).
