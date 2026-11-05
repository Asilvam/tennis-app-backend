# Etapa 2: emision de cuotas y bloqueo de reservas

Fecha: 2026-11-01. Proyectos originales, Node 22.19.0/npm 10.9.3.
Implementacion local del punto 3 aprobado. Sin despliegue, activacion, cuotas,
pagos ni cambios sobre la base del club. La etapa 3 se mantiene separada.

## Alcance ejecutado

Se conserva el motor `MembershipBillingService.ensureMemberDues`, usado por la
emision administrativa y `BillingLifecycleService.processMember`. No se crea
otro cron, coleccion, tarifa, dependencia, correo o variable de entorno.

Cambios funcionales acotados:

- `BillingPortalService.home` deja de llamar `prepareDues`. `POST /me/dues`
  devuelve cuotas emitidas hasta el mes actual, aunque haya meses sin emitir.
  No modifica socios, cuotas, pagos ni auditoria, con automatizacion activa o apagada.
- `MembershipBillingService.quoteInSession` deja de llamar `ensureMemberDues`.
  Valida solo el horizonte seleccionado: se puede pagar octubre sin emitir noviembre.
  Si falta un mes anterior facturable, responde 409 y solicita emision administrativa;
  no inventa una cuota para poder cobrarla. La cotizacion conserva los bloqueos de
  version del socio para serializar pagos/cambios, pero no emite cuotas ni dinero.
- Se conserva en la cotizacion el rechazo de beneficiarios con `statePlayer=false`,
  que antes se ejecutaba dentro del generador. No es una nueva restriccion:
  una carga inactiva sigue rechazada para titular y admin; un socio activo con
  deuda puede cotizar y pagar. Dos pruebas reprodujeron primero la regresion y
  luego verifican rechazo, rollback completo y pago permitido al volver a activo.
- Frontend: la confirmacion de apagar generacion ya no promete emision bajo demanda.
  Solo cambia el texto aprobado, no los contratos ni los permisos de los controles.

## Flujo manual y automatico

1. Con `automation.enabled=false`, consultas y cotizaciones no emiten meses.
   Administracion conserva vista previa y confirmacion de generacion con hash,
   `Idempotency-Key` y auditoria en `/admin/members/:id/dues`.
2. El POST administrativo antiguo sin hash sigue siendo una accion manual explicita
   de compatibilidad; puede preparar socio y familia habilitada. No se cambio ese
   contrato ni se agrego una emision global nueva.
3. Con generacion aprobada, el proceso existente comprueba al arrancar y cada hora
   en `America/Santiago`. El dia 1 incluye el nuevo mes; tras caida recupera meses
   facturables faltantes, no crea obligaciones fuera de vigencia.
4. El indice unico `(beneficiaryId, period)`, el bloqueo de version del socio y la
   transaccion serializan emision manual, procesos independientes y pagos concurrentes.
   Las cuotas existentes conservan ID, importe, estado y relacion de pago.
5. Activos con restriccion de pago siguen generando; inactivos y socios sin inicio
   aprobado no. Las tarifas e IDs piloto existentes no se modifican.
6. La baja automatica sigue dependiendo de su control separado. No se habilita por
   encender generacion ni se cambia la reinscripcion aprobada. La reapertura
   excepcional por nueva vigencia aprobada conserva su flujo y pruebas anteriores.

## Corte financiero del dia 6

Se reutilizan `dueAt`, `financialAccess`, `reservationPermissions` y
`MembershipAccessGuard`; no se agrega un booleano financiero persistido nuevo.

Octubre vence al terminar el 5 de noviembre. El 6 a las 00:00 de Chile una cuota
`OPEN` vencida impide nuevas reservas simples/multiples. La API verifica la deuda
en cada intento con el JWT existente, sin esperar al cron o a otro login.
Noviembre por si solo no bloquea el 6 de noviembre. Falta de emision vencida se
mantiene como revision requerida, no como prueba de pago o ingreso.

La cuenta activa conserva acceso segun su rol, portal e historial. Admin activo
mantiene exencion automatica; las cargas no heredan deuda del titular. Un pago
manual completo o MP verificado libera la restriccion financiera cuando no quedan
vencidas, sin quitar restricciones manuales ni activar cuentas inactivas. Un
checkout pendiente/UNKNOWN no acredita pago. Se puede pagar la cuota mas antigua
completa o varias consecutivas; no saltar octubre para pagar noviembre solo.

## Correccion adicional aprobada: seleccion de pendientes

`MembershipBatchEnrollment` solo asignaba todos los IDs `ELIGIBLE` al pulsar
Seleccionar pendientes; no existia la accion inversa. Ahora alterna con
Deseleccionar pendientes y expone `aria-pressed`. Una seleccion parcial permite
seleccionar todos; la siguiente pulsacion limpia la seleccion, cantidad e importe
y deshabilita Confirmar habilitacion. Sin candidatos el control queda deshabilitado.

No cambia elegibilidad: inactivos, ya habilitados y casos de revision siguen
deshabilitados. Seleccionar/deseleccionar es estado local: no envia habilitaciones,
cuotas ni pagos. No modifica el reintento idempotente de un lote incierto.
