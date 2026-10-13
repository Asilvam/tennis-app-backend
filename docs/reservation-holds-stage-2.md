# Etapa 2: retención local de reservas

El frontend retiene un turno con luz al abrir el modal. Un turno diurno se retiene al marcar Visita. El backend fija el vencimiento a dos minutos, usando su propio reloj. Elegir jugadores y abrir Mercado Pago no reinicia ese plazo. Las retenciones creadas antes de este cambio conservan el vencimiento ya guardado; las nuevas usan dos minutos.

## Flujo

- `POST /court-reserve/holds`: sesión JWT; crea una reserva pendiente y adquiere el bloqueo único por cancha, fecha y turno. No envía correo.
- `PATCH /court-reserve/holds/:id`: sesión del propietario; completa y valida los participantes una sola vez, antes del checkout.
- `DELETE /court-reserve/holds/:id`: sesión del propietario; libera inmediatamente si todavía no empezó el checkout.
- `POST /mp/init-point`: sesión JWT; usa esa misma reserva, guarda la preferencia y conserva el vencimiento original.
- El calendario recibe `isPendingPayment` y muestra el horario como no reservable. El frontend actualiza la disponibilidad cada cinco segundos.

Mongo conserva `reservation_slots` (bloqueo por horario) y los registros de `court_reserve`. Los vencimientos no borran documentos ni pagos. Las reservas anteriores continúan siendo reconocidas como ocupadas.

Un trabajador revisa vencimientos cada quince segundos. Un modal abandonado sin checkout puede liberarse automáticamente. Para un checkout iniciado, llama a `POST /mercadopago/reconcile-reservation`, protegido por la clave interna. Consulta todos los intentos disponibles; un pago pendiente, una respuesta incompleta o una caída del proveedor conserva el bloqueo y se reintenta. Por eso un pago ya en proceso puede superar los dos minutos de retención inicial.

Una aprobación tardía solo activa la reserva si el horario todavía está libre y no terminó. Si lo tomó otro usuario, se guarda el pago con `reservationStatus=PAYMENT_REVIEW_REQUIRED`, sin activar la reserva ni enviar una confirmación falsa. No se realizan reembolsos automáticos.

Una aprobación encontrada por conciliación se persiste en el inbox de Mercado Pago y se procesa con sus reintentos existentes. Esto conserva el trabajo pendiente aunque el correo falle después de activar la reserva. La preferencia utiliza el mismo vencimiento original mediante la [vigencia de Checkout Pro](https://www.mercadopago.cl/developers/es/docs/checkout-pro-preferences/additional-settings/term-of-preference).

## Prueba manual local

Ejecutar backend, frontend y Mercado Pago con URLs locales, Mongo de pruebas y credenciales de prueba. Esta etapa requiere los tres componentes actualizados juntos. Email-service mantiene su API actual.

1. Abrir el mismo día en dos sesiones de usuarios diferentes, sin reservas activas.
2. En la primera, abrir un horario con luz: aparece la cuenta regresiva. En la segunda, el horario pasa a Pendiente de pago y no se puede reservar.
3. Cerrar el primer modal: la segunda sesión vuelve a verlo disponible en la siguiente actualización.
4. Repetir en un turno diurno marcando Visita; quitar Visita libera la retención.
5. Abandonar el modal dos minutos: una retención sin checkout vence y el horario queda disponible.
6. Completar participantes e iniciar un checkout de prueba: confirmar que conserva el ID de reserva y el vencimiento original.
7. Probar pago pendiente, rechazado y aprobado con el proveedor de pruebas. Cerrar el navegador después de iniciar checkout no equivale a cancelarlo.

La integración se valida primero en local, sin despliegue automático. Se conservan `GET /mp/rates`, los montos calculados por el backend y la espera de 30 segundos para crear la preferencia. Las reservas pagadas no envían correo al crearse, incluso por el endpoint anterior; las gratuitas conservan su confirmación. El correo de estado de pago existente sigue funcionando. Correo final completo, deduplicación SMTP y consulta del estado real en las pantallas de retorno siguen fuera de esta etapa.

No se agregan variables de entorno. Mercado Pago debe incluir el nuevo endpoint de conciliación y soporte de `expiresAt`; backend y front deben publicarse de forma coordinada, porque `/mp/init-point` ahora exige JWT. No desplegar solo el backend con un frontend que todavía no envía la sesión. No se elimina ninguna colección ni registro existente.
