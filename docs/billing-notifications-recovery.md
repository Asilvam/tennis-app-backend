# Avisos de mensualidades: diagnostico y recuperacion

Fecha: 2026-10-30. Implementacion local sobre `develop`; no desplegada por esta tarea.

## Hallazgo

`BillingNotificationsService.drain()` se invoca con `@Interval(30000)`.
El aviso original `No se pudieron procesar los avisos pendientes de mensualidades.`
descartaba la excepcion del ciclo. Los logs aportados no permiten reconstruir
retrospectivamente su causa; no se afirma que haya fallado MongoDB o el correo.

Ademas, el envio y la escritura de `SENT` estaban dentro del mismo `try/catch`.
Un fallo de persistencia posterior al envio se trataba incorrectamente como fallo
de entrega y trataba de escribir `FAILED`.

## Cambios

- Diagnostico estructurado con `phase`, `errorType`, codigo numerico MongoDB o
  codigo de transporte permitido, y estado HTTP si esta disponible.
- Fases: `recover-expired-leases`, `find-pending`, `claim-notification`,
  `cancel-obsolete`, `send-email`, `persist-delivery-failure`, `persist-sent`.
- No se serializan mensajes originales, stacks, URI, destinatarios, cabeceras o
  respuestas del proveedor en estos nuevos diagnosticos. Tipos/codigos desconocidos
  se omiten o se sustituyen por `UnknownError`.
- `mongoose-buffer-timeout` y `email-service-not-configured` identifican dos
  errores conocidos mediante etiquetas fijas, sin exponer valores.
- `EmailService` conserva la causa original como propiedad no enumerable del
  error, manteniendo su mensaje y contrato actuales. El worker lee esa causa para
  recuperar codigo HTTP/transporte. No se cambia el logging legado de otros servicios.
- Un fallo del ciclo pausa nuevas consultas 30, 60, 120, 240 y hasta 300 segundos.
  Al completar un ciclo registra recuperacion y reinicia el contador.
- El fallo de un envio se registra antes de intentar guardar `FAILED`; si tambien
  falla MongoDB quedan ambos diagnosticos diferenciados.
- Si falla guardar `SENT`, no se intenta escribir `FAILED`. El aviso conserva su
  lease y la misma clave de idempotencia para una recuperacion posterior.

## Contratos preservados

- La cola sigue embebida en `membership_payments.notifications`, sin colecciones,
  dependencias, migraciones ni variables de entorno nuevas.
- Correo mediante `EmailService`, timeout de 15 segundos, misma `eventKey` como
  `Idempotency-Key`, maximo seis intentos por aviso y lease de cinco minutos.
- Avisos `CONFIRMED` obsoletos se cancelan sin enviar; `REVERSED` usa la plantilla existente.
- El indicador existente `MEMBERSHIP_BILLING_ADMIN_ENABLED` conserva su alcance:
  habilitado procesa todos los medios; deshabilitado, solo Mercado Pago.
- No se modifica el estado financiero, cuotas, cobros, reservas ni destinatarios.
- Sin cola externa/push, es necesario consultar periodicamente para descubrir
  avisos pendientes. Una cola vacia no genera warning. La pausa reduce consultas
  durante fallos, no elimina el sondeo normal cada 30 segundos.
- La pausa es local al proceso y se reinicia al arrancar. El lease MongoDB sigue
  coordinando instancias. No se promete entrega exactamente una vez: si el proveedor
  acepta el correo pero falla el acuse local, la deduplicacion depende de que el
  servicio de email respete la misma clave de idempotencia al reintentar.

## Evidencia

- Regresion Jest: **722 pruebas aprobadas, 184 omitidas, 0 fallidas**;
  50 suites aprobadas y siete integraciones MongoDB omitidas por no configurar una
  base aislada para esta ejecucion.
- Las nuevas pruebas cubren cola vacia, modo existente, envio/anulacion, reclamo
  concurrente perdido, fases de fallo, backoff/recuperacion, no solapamiento local,
  sanitizacion, seis intentos y fallo al guardar el acuse de entrega.
- `EmailService` verifica causa original no enumerable y conserva las pruebas de
  reset de password, verificacion y contratos existentes.
- TypeScript: `tsc --noEmit --incremental false`, sin errores.
- Repeticion tras limpiar el formato de la nueva prueba: 37 pruebas focalizadas
  aprobadas, sin fallos, en worker, servicio de correo y plantillas de mensualidades.
  `cleanupValidation` conserva los hashes de esa repeticion; la evidencia de la
  regresion completa anterior se mantiene sin reemplazar sus resultados.
- Resumen generado y hashes: [validation.json](evidence/billing-notifications/validation.json).
- Primera ejecucion sin permiso de puertos fallo con `listen EPERM`; se repitio
  con permiso para HTTP local y los resultados aprobados corresponden a esa repeticion.
- No se inicio `AppModule`, no se uso la base del club ni se enviaron correos reales.

Comandos principales desde el backend, con Node 22:

```sh
BILLING_TEST_MONGO_URI= node node_modules/jest/bin/jest.js --runInBand --silent --json --outputFile=/private/tmp/ctq-billing-notifications-regression.json
node node_modules/typescript/bin/tsc --noEmit --incremental false
git diff --check
```

## Diagnostico operativo posterior

Tras publicar y reiniciar el backend, buscar el siguiente warning estructurado.
`phase` indica la operacion; `errorType`, `code` y `hint` permiten separar permisos,
conexion, consulta y envio sin imprimir datos privados. `persist-sent` exige revisar
el acuse del servicio de correo antes de cualquier reenvio manual. No borrar pagos,
reiniciar contadores de avisos ni crear otro cobro para resolver un correo fallido.

La causa concreta de los warnings anteriores y la validacion del servicio desplegado
siguen pendientes de observar con este diagnostico. No es evidencia de un fallo de pago.
