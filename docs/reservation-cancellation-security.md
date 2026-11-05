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

## Pruebas y Evidencia

- 20 unitarias nuevas: guard JWT, identidad, estado, rol persistido, propietario,
  legacy sin creador, plazo exacto/iniciado, fecha invalida, turno nocturno,
  conflicto, auditoria del actor y captura del creador autenticado.
- Regresion backend: 746 aprobadas, 0 fallidas; 211 integraciones antiguas omitidas,
  no certificadas por esta ejecucion.
- `test/reservation-cancellation.e2e.ts`: 26 controles HTTP con Nest/JWT/MongoDB
  y ReservationSlotService reales; datos ficticios y reloj Luxon fijo.
  Prueba rechazo sin efectos, roles obsoletos, propietario distinto de Player 1,
  creacion con ownerEmail falsificado y dos cancelaciones concurrentes.
- Correos y auditoria son dobles de prueba contados; no se envia correo real.
  No se importa AppModule, .env, cron ni proveedor de pagos. La base se elimina
  al finalizar y MongoDB temporal se apaga tras las pruebas.
- TypeScript backend y ESLint de archivos nuevos aprobados. Para esos archivos
  se usa printWidth 120; la configuracion local ajena no se modifica.
- El frontend existente ya adjunta Bearer al crear y cancelar. Sin cambios de UI
  ni nuevas pruebas de dispositivo fisico en esta tarea.

Reportes sanitizados y hashes: `docs/evidence/reservation-cancellation/`.

```bash
node node_modules/jest/bin/jest.js --runInBand court-reserve.cancellation.spec.ts
node node_modules/jest/bin/jest.js --runInBand
node node_modules/typescript/bin/tsc --noEmit --incremental false -p tsconfig.build.json
node -r ts-node/register test/reservation-cancellation.e2e.ts mongodb://127.0.0.1:29479/ctq_cancel_test_permissions /private/tmp/ctq-cancellation-validation
```

El arnes solo acepta loopback y una base con prefijo `ctq_cancel_test_`; esa
restriccion existe exclusivamente en el test, no en el arranque de la aplicacion.
No hay variables nuevas: README actualizado; env.example no requiere cambios.

## Limites

Alcance aprobado: autorizacion del DELETE y procedencia del creador en nuevas
reservas normales. No constituye una auditoria de todas las rutas legadas.
Las reservas sin creador siguen apareciendo en el historial de sus participantes;
el backend exige administrador para cancelarlas. No se ocultaron botones ni se
reclasificaron datos antiguos como parte de esta correccion.
