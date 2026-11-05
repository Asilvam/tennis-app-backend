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
