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
PASSWORD_RESET_FRONTEND_URL=http://localhost:5173/restablecer-contrasena

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

1. Para una reserva pagada, el frontend retiene el horario mediante `POST /court-reserve/holds` al abrir el modal nocturno o marcar Visita. Antes del checkout, valida participantes con `PATCH /court-reserve/holds/:id` y solicita una preferencia mediante `POST /mp/init-point`. Estos endpoints requieren JWT y respetan al propietario de la sesión.
2. El backend recupera la reserva persistida y calcula el importe; no confía en un importe enviado por el navegador.
3. El backend llama a `POST /mercadopago/create-preference` en el microservicio con el vencimiento original. Un checkout guardado se reutiliza en lugar de crear otra preferencia.
4. Mercado Pago envía el webhook firmado al microservicio.
5. El microservicio persiste el evento antes de responder y lo procesa mediante reintentos con backoff.
6. El microservicio llama al backend para actualizar la reserva y enviar el correo.
7. El backend utiliza `Idempotency-Key` y persistencia MongoDB para evitar actualizaciones y correos duplicados.

Las reservas pagadas no envían correo previo al pago; las gratuitas conservan su correo de confirmación. El correo de estado del pago sigue usando la API existente del servicio de correo. El bloqueo dura dos minutos desde su creación, no desde el checkout. `DELETE /court-reserve/holds/:id` libera inmediatamente una retención sin checkout. Una operación ya iniciada solo se libera tras conciliar con Mercado Pago; si está pendiente o el proveedor falla, la cancha sigue bloqueada. Ver [retenciones y prueba local](docs/reservation-holds-stage-2.md).

La creación de la preferencia espera hasta 30 segundos al microservicio, en lugar de 10, para dar margen a su arranque. Esta espera coincide con el [límite de 30 segundos del router de Heroku](https://devcenter.heroku.com/articles/request-timeout); como la consulta previa a Mongo también consume tiempo, Heroku puede cortar la solicitud con H12 antes de que el backend devuelva su respuesta controlada. Si Axios agota la espera (`ECONNABORTED` o `ETIMEDOUT`), el backend devuelve `504`, siempre que el router aún mantenga la conexión. No reintenta automáticamente: el microservicio podría haber creado la preferencia aunque el backend no haya recibido la respuesta. Este timeout no confirma ni cancela un pago o una reserva y no requiere variables de entorno nuevas.

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

La edición administrativa de socios usa `PATCH /register/admin/:email` con JWT admin. Permite seleccionar Titular/Carga y asociar cada carga mediante `titularId`. Los valores históricos Familiar se conservan hasta editar la asociación. La asociación por sí sola no genera cuotas ni registra pagos; un cambio de tipo ajusta las cuotas impagas del mes actual y futuros según las reglas de [Mensualidades CTQ](#mensualidades-ctq). Las asociaciones requieren Mongo con soporte de transacciones. Ver también el [diseño original de socios](docs/membership-management-stage-1.md).

El acceso depende de dos propiedades del socio:

- `statePlayer=false`: cuenta inactiva; no es lo mismo que una restricción financiera.
- `updatePayment=false`: restricción financiera legada que requiere revisión administrativa; no es un registro de deuda ni prueba de un pago.

El login rechaza cuentas inactivas. Con el portal de mensualidades habilitado, un socio activo con restricción financiera puede ingresar solo a pagos, sin reservar. Si el portal está deshabilitado, se conserva el rechazo legado por `updatePayment=false`. Un pago no modifica silenciosamente una baja administrativa ni ese indicador legado.

### Permisos de registro y edición

- `POST /register` continúa público, pero solo acepta nombre, correo, celular, contraseña, tipo de socio, categorías y URL de verificación. Campos administrativos o de verificación enviados por el cliente se rechazan con `400`.
- El servidor conserva la política de alta existente: `role=user`, `statePlayer=false`, `updatePayment=true` y `emailVerified=false`. El token de verificación lo genera el modelo. `updatePayment=true` no equivale a un pago confirmado ni a una cuota pagada.
- `PATCH /register/:email` requiere JWT y solo permite editar el perfil propio (nombre, celular y fotografía). Los campos de permisos/pago se rechazan; otra cuenta recibe `403`.
- `POST /register/profile` requiere JWT para subir una fotografía.
- `PATCH /register/admin/:email` y `PATCH /register/payment/{enable|block}/:email` requieren JWT con rol admin. Sin JWT devuelven `401`; usuarios y profesores reciben `403` en las rutas administrativas.

El front debe enviar el JWT en las dos llamadas de actualización de fotografía. Coordinar el despliegue de backend y front: el front antiguo sin esos encabezados recibirá `401`. No se modifican cuentas existentes, tarifas, variables de entorno, Mercado Pago ni el contrato del servicio de correo.

Las pruebas de permisos usan JWT de prueba, HTTP local y servicios simulados, sin correos ni Mongo de producción:

```bash
npm test -- --runInBand --runTestsByPath src/register/register.security.spec.ts src/register/register.admin.spec.ts src/register/register.service.spec.ts
```

Esta protección no constituye una auditoría completa de seguridad. El restablecimiento inseguro se reemplazó por un enlace de un solo uso: el usuario puede solicitarlo sin sesión y un admin desde administración. Solo se envía a cuentas activas (`statePlayer=true`). El usuario espera 24 horas entre solicitudes aceptadas, incluso si falla el correo; el administrador autenticado no tiene límite de espera, pero tampoco puede enviar a cuentas inactivas. La contraseña actual no cambia hasta confirmar; no se devuelve ni se envía una contraseña por correo. El enlace público dura quince minutos y el de administración dura 24 horas; ambos requieren `PASSWORD_RESET_FRONTEND_URL` del backend. Por decisión explícita, las sesiones JWT anteriores siguen válidas hasta vencer. Ver [flujo, límites y pruebas de recuperación](docs/password-recovery.md).

## Mensualidades CTQ

Reglas acordadas el **26 de octubre de 2026**, con implementación local de las nuevas etapas 1 y 2 e histórico no exigible actualizados al **27 de octubre de 2026**. Esta sección es la referencia del flujo vigente; los documentos anteriores conservan decisiones históricas. Una implementación probada en local no activa tareas ni demuestra su publicación en producción.

### Estado de implementación

| Función | Estado |
| --- | --- |
| Cuotas individuales, tarifas, historial, auditoría e idempotencia | Implementado |
| Portal del socio y registro administrativo de transferencia/depósito | Implementado |
| Mercado Pago, conciliación, confirmación y correo mensual | Implementado; piloto real previo de Test 1 y Test 2 confirmado |
| Socio: atrasados y mes actual; administración: actual más tres futuros | Implementado |
| Búsqueda rápida y corrección de solapes móviles de administración | Probado en local; pendiente de publicación al documentar esta sección |
| Permisos de lectura sin esperar disponibilidad de Mercado Pago | Optimización probada en local; pendiente de publicación |
| Botón para habilitar mensualidades de un socio y aprobar su inicio | Implementado y probado en local, pendiente de publicación |
| Vigencia inicial e intervalos de facturación | Implementado en local; historial privado y sin migración automática de socios anteriores |
| Registro administrativo de efectivo | Implementado y probado en local; medio y folio propios, sin referencia bancaria ficticia |
| Generación mensual, baja por tres cuotas y reinscripción | Implementado en local; automatización desactivada por defecto, sin activación del club |
| Redirección global al login por sesión vencida | Fallo identificado; corrección pendiente |

El piloto y sus pruebas no equivalen a habilitación general del club. El bloqueo automático por deuda quedó desactivado durante el piloto; revisar su configuración y aprobar su activación por separado. Esta documentación no consulta ni modifica el ambiente desplegado.

### Reglas de cobro y estados del socio

- Moneda CLP y cuotas completas: titular **$18.000**, carga **$5.000**. Sin abonos parciales; el monto recibido debe coincidir exactamente con las cuotas seleccionadas y lo calcula el backend.
- Tarifa de prueba **$180/$50** exclusivamente para los IDs autorizados de Usuario test 1 y Usuario test 2; no se determina por nombre. Los demás socios usan tarifa general.
- Cobro por mes calendario vencido: octubre de 2026 puede pagarse hasta el **5 de noviembre de 2026 inclusive**. Desde el día 6 está vencido. Todos los cortes usan `America/Santiago`, no la zona del servidor.
- Primero se pagan los meses impagos más antiguos de cada beneficiario. Un titular puede pagar por sí mismo y por sus cargas vinculadas; cada socio conserva sus propias cuotas e historial.
- El socio puede pagar atrasados y el mes actual, sin anticipar meses futuros. Administración conserva el mes actual más tres futuros, sin saltar deuda anterior ni ampliar la ventana por haber pagado el último mes disponible.
- La deuda anterior a octubre de 2026 no se inventa al inicializar el sistema. El inicio de cada socio requiere aprobación explícita; una cuenta activa no implica mensualidades habilitadas ni cuotas pagadas.
- Cambiar Titular/Carga ajusta solo cuotas `OPEN` del mes actual y futuros, con auditoría. Conserva cuotas pasadas y pagadas; un checkout pendiente o incierto impide cambiar importes que todavía podrían cobrarse.

| Situación | Nuevas cuotas | Acceso y tratamiento |
| --- | --- | --- |
| Activo, con inicio de facturación aprobado | Sí, durante sus períodos de vigencia | Acceso normal si no tiene restricciones |
| Activo, restringido por falta de pago | Sí; el bloqueo financiero no suspende su membresía | Solo mensualidades; sin reservas cuando corresponda aplicar la restricción |
| Cuenta inactiva o dada de baja | No durante la inactividad ni después del corte efectivo | Sin login ni registro de pagos habilitado en la interfaz actual; conservar deuda e historial |
| Sin inicio de facturación aprobado | No | Mostrar revisión pendiente, sin estimar una deuda como si estuviera emitida |
| Administrador activo | Según su membresía e inicio aprobados | Exento del bloqueo financiero; no de la inactividad administrativa |

`register` es la fuente de identidad, tipo y estado del socio. `membership_dues` guarda sus cuotas; `membership_payments`, sus pagos e imputaciones; `membership_billing_config`, las tarifas y configuración. Los booleanos de acceso nunca sustituyen esos registros financieros.

### Uso por administración: habilitar y registrar pagos

**Entrada existente:** Administrar usuarios → botón **Pagos del socio**. También puede buscarse al socio en Mensualidades CTQ (`/adminpayments`). La consulta global por mes es solo lectura: no debe generar cuotas ni depender de que Mercado Pago esté disponible. Desde Usuarios se conserva la búsqueda y la posición al volver.

1. **Habilitación inicial, implementada en local:** desde el detalle elegir **Habilitar mensualidades**, indicar mes inicial y motivo, y pulsar **Revisar cuotas**. La vista previa muestra importes calculados por el backend; **Confirmar habilitación** exige SweetAlert2 y guarda inicio, vigencia, cuotas abiertas y auditoría en una transacción, sin registrar dinero. Solo permite socios activos y una primera habilitación sin registros financieros previos; no reemplaza inicios o historiales anteriores ni habilita cargas sin un titular válido. Si cambian precios o datos después de la vista previa, exige revisarla de nuevo. Un timeout se reintenta con la misma clave de idempotencia. Desde el listado global también hay una acción de habilitación para activos sin inicio aprobado.
2. **Transferencia o depósito, disponible:** abrir **Registrar pago**, seleccionar cuotas completas desde la más antigua, identificar pagador y beneficiarios, elegir el medio correcto e indicar fecha efectiva, referencia y observación. Verificar el ingreso real en banco y confirmar el total calculado. Por ahora no se adjuntan comprobantes.
3. **Persistencia:** guardar pago confirmado, imputaciones y auditoría en una transacción. El historial muestra medio, meses, monto, pagador y administrador responsable. El correo se envía después y puede reintentarse sin cobrar ni registrar otra vez.
4. **Efectivo, implementado en local:** elegir **Efectivo** en el mismo formulario, identificar pagador, fecha y cuotas, y confirmar **Recibí este monto completo en efectivo**. El backend genera el folio y registra como receptor al administrador autenticado. No solicita referencia bancaria y rechaza evidencia bancaria o del proveedor enviada como si fuera efectivo. El historial y el correo identifican el medio y folio propios.
5. **Corrección:** un registro manual confirmado (banco o efectivo) se anula con motivo y auditoría y se registra correctamente; no se sobrescribe el monto. Conserva folio/evidencia y reabre únicamente sus cuotas. La anulación no devuelve dinero y nunca se aplica a Mercado Pago.

No registrar manualmente como depósito una operación de Mercado Pago ya recibida. Un reintento tras timeout conserva referencia, selección y clave de idempotencia; consultar primero el intento existente. Los pagos de Mercado Pago no se anulan ni modifican mediante el flujo bancario.

### Uso por el socio: Mercado Pago

1. Entrar a **Mis mensualidades** (`/monthlypayments`), incluso con acceso restringido por deuda si la cuenta sigue activa.
2. Seleccionar sus cuotas y, si es titular, las de sus cargas autorizadas. El servidor revalida identidad, períodos, orden y total.
3. Confirmar y continuar a Mercado Pago. El backend persiste el intento antes de solicitar la preferencia.
4. Volver a la pantalla de resultado (`/monthlypayments/return`). El retorno y sus parámetros no prueban que hubo pago: confirmar solo con evidencia verificada del proveedor.
5. Al confirmarse, las cuotas quedan pagadas y aparecen en el historial del socio y de administración. Un pago pendiente, rechazado o abandonado no cancela deuda. Un fallo de correo no revierte un pago confirmado.

Regularizar cuotas permite retirar la restricción derivada de esas deudas, si no existen otras. No borra una inactividad, una baja ni un bloqueo legado sujeto a revisión. Un pago recibido después de la baja se conserva y revisa sin reactivar automáticamente la membresía. Tras reinscripción aprobada, las anteriores impagas son histórico no exigible: no se cobran ni restringen reservas.

### Creación mensual y baja: implementación local

Una vez aprobada la automatización no es necesario crear manualmente cada mes. Se conserva la preparación bajo demanda. La nueva tarea recuperable se ejecuta cada hora en `America/Santiago`, incluidos cambios de mes y el inicio del día 6. **Permanece desactivada** sin aprobación explícita en `membership_billing_config.automation`, independiente del bloqueo financiero. No se agregó una variable de entorno ni se activó sobre datos reales.

1. Genera cuotas de activos habilitados y vigentes con tarifa de backend e índice único socio/período. Incluye restringidos por deuda; excluye inactivos y períodos sin vigencia.
2. Recupera ejecuciones faltantes sin duplicar. El listado no ejecuta la tarea. Una transacción por socio evita que un error interrumpa a todos.
3. Concilia intentos inciertos de Mercado Pago antes de decidir bajas. Usa fecha efectiva del pago, no llegada del webhook. Pendientes, desconocidos o en revisión retienen la baja; un timeout no prueba cancelación.
4. Con **tres mensualidades vencidas consecutivas de la vigencia actual**, la baja es efectiva el día 6. No cuenta noventa días. Desde las 00:00 del día 6 un pago ya está fuera del plazo del día 5.
5. Conserva cuotas anteriores al corte. Las posteriores impagas quedan `VOID`, **Sin cobro por baja**, con motivo y fechas, sin borrarse ni aparecer pagadas. Una futura ya pagada queda en revisión, sin devolución automática.
6. Guarda cierre, corte efectivo y auditoría deduplicada. Tras una caída recupera el corte original. Historial de vigencia ausente o pagos anulados que afectan el corte requieren revisión administrativa.

**Ejemplo aprobado:** octubre vence el 5 de noviembre, noviembre el 5 de diciembre y diciembre el 5 de enero. Si esas tres cuotas siguen impagas, la baja es el **6 de enero de 2027**; conserva deuda de octubre, noviembre y diciembre y **no se cobra enero**, aunque hubiera estado habilitado los primeros cinco días. Esta regla reemplaza cualquier suposición de cobrar enero completo en ese caso.

El bloqueo financiero para reservas y la baja de membresía son procesos distintos. Aprobar estas reglas no activa ninguno sobre el club; su configuración, vista previa y habilitación requieren revisión administrativa. Los administradores están exentos del bloqueo financiero y no deben quedar incluidos automáticamente en una baja masiva.

### Reinscripción y períodos de vigencia

- Después de la baja, pagar no reactiva al socio: necesita nueva inscripción aprobada. **No se exige pagar deuda anterior para reinscribirse.**
- Se reutiliza el mismo socio e ID, preservando cuotas, pagos y auditoría; no se sobrescribe el inicio histórico.
- Desde Mensualidades → detalle → **Reinscribir socio**, revisar mes actual, importe nuevo e histórico anterior, indicar motivo y confirmar con SweetAlert2. Solo aplica a bajas automáticas con cierre válido; la activación genérica no puede saltarse la aprobación.
- La aprobación abre vigencia desde el mes actual, sin cargo extra ni meses inactivos. Las anteriores `OPEN` pasan a `ARCHIVED`, **Histórico no exigible**, con responsable, motivo y fecha: no exigen pago, no bloquean reservas y no aparecen pagadas. Los pagos reales permanecen intactos.
- Una anulación manual posterior de un pago antiguo conserva su cuota como histórico no exigible. Un cobro tardío de MP sobre `VOID`/`ARCHIVED` queda en revisión, sin imputación automática.
- No se habilitan pagos manuales de inactivos ni devoluciones automáticas. Los anticipos o evidencias inciertas se revisan antes de una baja.
- Una baja manual fuera del ejemplo automático requiere un período efectivo explícito; no inferir un prorrateo o un corte distinto sin decisión administrativa.

Las nuevas etapas guardan `billingPeriods` y `billingClosure` privados. Generación y cotización respetan los intervalos. Socios anteriores sin historial no se migran automáticamente: se señalan para revisión antes de una baja. No se agregó una baja manual fuera de este flujo.

### Mantención operativa

- **Diaria:** revisar intentos pendientes o inciertos, pagos en revisión, correos fallidos y ejecuciones incompletas. Conciliar la misma referencia antes de abrir un nuevo cobro.
- **Mensual:** comprobar ejecución de generación, cantidades por tipo de socio y períodos, sin duplicados; desde el día 6 revisar bajas y casos retenidos. Comparar banco y Mercado Pago con el historial y conciliar efectivo por sus folios.
- **Cambios administrativos:** registrar inicio, baja, reinscripción, tipo y asociación titular/carga con fecha/período efectivo y auditoría. No editar cuotas o pagos directamente en MongoDB como procedimiento habitual.
- **Tarifas:** mantener versiones en `membership_billing_config`; no en React ni en variables nuevas de entorno. No reescribir pagos históricos al cambiar precios.
- **Despliegues:** conservar evidencia de pagos, inbox y auditoría; revisar pendientes antes de una reversión. Revertir código no revierte dinero. No borrar pagos reales para limpiar pruebas.
- **Interfaz:** respetar colores CTQ, CSS de la ventana, controles móviles legibles y SweetAlert2 para confirmaciones y errores. No agregar pantallas ni campanas de notificación a este alcance sin aprobación.

### Plan de implementación y aceptación

Este plan completa el trabajo pendiente de habilitación general; no reabre las etapas ya entregadas ni autoriza por sí solo cambios sobre datos reales.

| Etapa | Entrega y condición de cierre |
| --- | --- |
| 1. Habilitación y pagos administrativos | Habilitación individual con vista previa, vigencia inicial y auditoría; efectivo con folio, receptor y total exacto; historial y corrección sin alterar Mercado Pago. Implementado y probado en local. |
| 2. Automatización mensual y bajas | Generación recuperable, corte del día 6, futuras impagas sin cobro; cierre y reinscripción con histórico no exigible, sin meses inactivos cobrados. Implementado en local, sin activación general. |
| 3. Piloto y liberación | Piloto/regresión y respaldo/restauración locales verificados. Revisión de solo lectura de Heroku/base/proveedor realizada el 27 de octubre; quedan inicio/vigencias, metadato `UNKNOWN` confirmado y sesión vencida por resolver. Respaldo real, despliegue y activación requieren aprobación separada. |

Detalles: [etapa 1, habilitación y efectivo](docs/membership-billing-enrollment-cash-stage-1.md), [etapa 2, automatización y reinscripción](docs/membership-billing-lifecycle-stage-2.md) y [etapa 3, piloto y liberación](docs/membership-billing-release-stage-3.md). Estas tres etapas consolidan el plan operativo; no cambian la numeración histórica de las entregas originales.

**Pruebas obligatorias:** pagos completos y por medio, titular/carga, idempotencia y concurrencia, privacidad, cuentas inactivas, restringidos que siguen generando, límites del día 5/6 y zona chilena, tres cuotas vencidas, enero sin cobro en el ejemplo, cuota futura ya emitida, pausas/reinscripción, evidencia de pago recibida tarde, recuperación de tareas, fallo de correo y regresión de reservas/luz/visitas. Verificar también iPhone/iPad/escritorio; una simulación no certifica Safari en un equipo físico.

Las pruebas de integración requieren un replica set local aislado mediante `BILLING_TEST_MONGO_URI` y una base `ctq_billing_test_*`; no usar la URI de producción. Sin esa configuración las integraciones se omiten, no se consideran aprobadas. Proveedor y correo deben simularse salvo el piloto real autorizado explícitamente.

Referencias técnicas históricas: [base de cuotas](docs/membership-billing-stage-2.md), [registro bancario e historial](docs/membership-billing-stage-3.md), [portal y Mercado Pago](docs/membership-billing-stage-4-5.md) y [criterios de liberación](docs/membership-billing-stage-5-release.md). Ante diferencias de reglas, prevalecen las decisiones fechadas de esta sección; el estado desplegado debe verificarse por separado.

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
