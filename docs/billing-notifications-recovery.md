# Avisos de mensualidades: diagnostico y recuperacion

> Documento historico. El 2026-10-31 el usuario solicito retirar este proceso y
> sus correos. El worker, sus reintentos y las plantillas fueron eliminados del
> codigo local. Ver [retiro y verificacion actual](billing-email-removal.md).
> Las mediciones siguientes corresponden a la implementacion anterior.

Fecha: 2026-10-30, zona `America/Santiago`. Documento historico del diagnostico
del worker, conservado como referencia tecnica tras su retiro.

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

## Diagnostico operativo posterior

Tras publicar y reiniciar el backend, buscar el siguiente warning estructurado.
`phase` indica la operacion; `errorType`, `code` y `hint` permiten separar permisos,
conexion, consulta y envio sin imprimir datos privados. `persist-sent` exige revisar
el acuse del servicio de correo antes de cualquier reenvio manual. No borrar pagos,
reiniciar contadores de avisos ni crear otro cobro para resolver un correo fallido.

La causa concreta de un warning debe comprobarse con el diagnostico de la fase
afectada. Un error de entrega de correo no implica por si solo un fallo de pago.
