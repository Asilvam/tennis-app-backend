# Retiro de correos automaticos de mensualidades

Fecha: 2026-10-31. Zona: America/Santiago.

## Decision y alcance

El usuario solicito desactivar y retirar el proceso automatico de correo de
mensualidades. No se sustituye por otro scheduler, envio sincrono, cola o variable
de entorno. El retiro requiere ejecutar esta version del backend; no desactiva
una version anterior que siga en ejecucion en local o Heroku.

## Cambios tecnicos

- Eliminados `BillingNotificationsService`, su intervalo de 30 segundos,
  reintentos, recuperacion de leases y plantilla `buildMembershipPaymentEmail`.
- `MembershipBillingModule` ya no registra el worker ni importa `EmailModule`.
- `BillingAdminService` ya no encola avisos al registrar transferencias,
  depositos, efectivo o anulaciones. Las transacciones, folios, auditoria e
  idempotencia financiera se mantienen.
- `MembershipMpService` sigue confirmando evidencia del proveedor y pagando
  cuotas, sin crear avisos. No se modifica el webhook ni su autenticacion.
- Se conserva el esquema `notifications` exclusivamente para no perder evidencia
  antigua. No se ejecuta ninguna migracion ni se vacian documentos existentes.
- El detalle administrativo mantiene `notificationStatus: null` para conservar
  el contrato del frontend, que muestra `No requerido`. No presenta una cola
  abandonada como una tarea pendiente de envio.
- El informe de liberacion conserva `mailToReview: 0` por compatibilidad; los
  avisos antiguos fallidos no bloquean la revision de pagos.
- `.env.example` solo actualiza la descripcion del correo compartido. No se
  agregan ni eliminan variables: siguen siendo necesarias para otros flujos.

## Comportamiento preservado

El historial de pagos, generacion de cuotas, tarifas, acceso financiero,
automatizacion de vigencias y bajas, reservas, ranking y resultados conservan
sus reglas. La recuperacion de contrasena, verificacion de cuenta y correos de
reservas mantienen sus servicios. El retiro no resuelve una intermitencia de
MongoDB: elimina este consumidor automatico y sus warnings, no fallos de red
que puedan afectar a otras operaciones.

## Verificacion

Pruebas locales con proveedor y correo simulados, HTTP/JWT y MongoDB replica set
aislado en `127.0.0.1:27371`. No se carga `.env` ni `AppModule` en las pruebas;
no se utiliza Atlas ni se realizan pagos, correos o despliegues reales.

Los casos nuevos verifican ausencia del worker y de la dependencia de correo,
pagos nuevos sin avisos, preservacion de evidencia antigua al anular o confirmar
por MP, idempotencia y compatibilidad del detalle administrativo. Las pruebas
especificas del worker retirado se eliminan; el total no debe compararse como si
esas funcionalidades siguieran vigentes.

Resultado: **883 pruebas aprobadas, 56 suites, 0 fallos y 0 omitidas**.
Incluye **182 integraciones** con MongoDB real aislado: 50 administrativas,
40 de Mercado Pago, 40 de vigencias, 20 de cuotas, 16 de ajustes de tarifa,
6 de resultados y 10 de categorias. Proveedor y envios externos simulados.

TypeScript, build Nest, `git diff --check` y ESLint de los archivos modificados
aprobados. ESLint usa `printWidth: 100` explicito porque existe una modificacion
local previa de `.prettierrc` ajena a este retiro; no se modifica esa preferencia.
El build limpio no contiene archivos del worker ni de la plantilla eliminada.
El servidor MongoDB temporal quedo detenido al terminar.

Evidencia generada desde el resultado Jest, con cantidades, casos y hashes:
[validation.json](evidence/billing-email-removal/validation.json).
El JSON completo de Jest queda en
`/private/tmp/ctq-billing-no-email-20261031/regression.json`.

La cifra historica de 908 correspondia al worker todavia instalado. Se retiraron
31 pruebas exclusivas del envio eliminado y se agregaron 6 de retiro y
compatibilidad; no se omitieron las integraciones financieras existentes.

Durante la validacion no se realizo commit, push, reinicio del backend del usuario
ni despliegue a Heroku.
Los documentos de etapas previas que describen correo corresponden al alcance
anterior y quedan reemplazados por esta decision para el envio mensual.
