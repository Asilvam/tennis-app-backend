# Autorizacion de Cancelacion de Reservas

Fecha: 2026-11-05. Cambio local aprobado; sin despliegue.

## Decision Funcional

- Administrador activo: puede cancelar cualquier reserva activa, aunque no tenga
  creador registrado o el turno haya comenzado.
- Socio activo: solo puede cancelar la reserva cuyo `ownerEmail` coincide con su
  cuenta autenticada y antes del inicio del turno, en America/Santiago.
- Sin creador verificable: solo administrador. No se infiere propiedad de Player 1,
  de otros participantes, del JWT role ni del cuerpo de la solicitud.
- Una restriccion financiera no convierte la cancelacion en una nueva reserva:
  el socio activo conserva esta accion sobre sus propias reservas.
- Cuenta inactiva/inexistente o sesion invalida: no puede cancelar.

No se asignan propietarios retrospectivamente ni se migran datos. Las reservas
antiguas con ownerEmail persistido conservan esa identidad, incluidas las de pago.

## Implementacion

`CourtReserveController` agrega `JwtAuthGuard` a `DELETE /court-reserve/:id`.
Transfiere solo `request.user.email` a `CourtReserveService.remove`.
El servicio consulta `RegisterService.findOneByEmail` y valida estado/rol vigentes
en base: un JWT con rol admin obsoleto no concede privilegios administrativos.

Antes de cambiar estado se consulta la reserva, se valida propiedad y, para socios,
se calcula el inicio mediante fecha ISO y hora inicial del turno con Luxon.
La actualizacion condicional exige `state: true`; para socios incluye propietario,
fecha y turno leidos, para rechazar una modificacion concurrente. Solo una
cancelacion gana la escritura; las posteriores no repiten efectos.

Tras la transicion se libera el slot CONFIRMED mediante el servicio existente,
se registra auditoria con el actor real y se intenta el correo existente.
Los bloqueos administrativos mantienen su ausencia de correo. Fallos de correo
se registran sin presentar una reserva cancelada como si siguiera vigente.
No se agrega cola, worker, scheduler ni mecanismo nuevo de reintentos.

`POST /court-reserve` tambien exige JWT y usa `createAuthenticated` para guardar
`ownerEmail` desde la cuenta autenticada, nunca del payload o del nombre Player 1.
Reutiliza el campo existente y la creacion actual; no cambia participantes,
precios, reglas de ranking ni la politica financiera global.
La retencion de pago ya guarda su creador y no cambia con esta correccion.
Creaciones administrativas/internas sin creador quedan bajo la regla admin-only.

## Respuestas

| Estado | Caso |
| --- | --- |
| 200 | Reserva cancelada |
| 401 | JWT ausente, invalido, vencido o sin identidad |
| 403 | Cuenta no activa, reserva ajena/sin creador o plazo del socio vencido |
| 404 | Reserva inexistente, despues de validar la cuenta |
| 409 | Reserva ya cancelada o modificada al reclamar la escritura |

No se cambia `DELETE /court-reserve/holds/:reservationId`, reembolsos ni callbacks.
Una cancelacion no registra una devolucion ni altera el importe del pago.
No se afirma atomicidad transaccional entre reserva, slot, auditoria y correo:
la escritura condicional evita duplicados, pero una caida entre esos efectos
requiere revision operativa, igual que otros fallos de infraestructura.

## Limites

Alcance aprobado: autorizacion del DELETE y procedencia del creador en nuevas
reservas normales. No constituye una auditoria de todas las rutas legadas.
Las reservas sin creador siguen apareciendo en el historial de sus participantes;
el backend exige administrador para cancelarlas. No se ocultaron botones ni se
reclasificaron datos antiguos como parte de esta correccion.
