# Habilitación manual, familiar y masiva de mensualidades

Implementación local del 27 de octubre de 2026. No ejecuta altas, migraciones ni
correcciones en Heroku; publicar código tampoco aprueba la habilitación del club.

## Plan y alcance

1. Unificar la detección de pagos inciertos y reutilizar el plan y la transacción de
   habilitación individual. Conservar los registros aprobados por cualquier vía.
2. Agregar selección de titular/cargas y un lote global dentro de Mensualidades, con
   vista previa, motivo y SweetAlert2. Sin pantallas nuevas ni variables de entorno.
3. Proveer revisión específica de vigencias antiguas y validar permisos, concurrencia,
   reintentos, integridad de pagos y flujo responsive con datos locales aislados.

## Uso manual

Usuarios → Pagos del socio. Un socio sin cargas conserva la habilitación individual.
Para un titular con cargas pendientes, **Habilitar titular y cargas** muestra el grupo
con selección individual: no obliga a habilitar a todos ni reactiva cuentas inactivas.
Elegir mes inicial, revisar cuotas calculadas por backend, indicar motivo y confirmar.

La selección empieza vacía. El mes inicial predeterminado es el actual; no se inventa
deuda previa ni se marcan cuotas como pagadas. Tarifas generales $18.000/$5.000 y
tarifas de prueba $180/$50 solo para los IDs ya autorizados en configuración.

## Uso masivo

Mensualidades → **Habilitar socios**. La vista previa no escribe nada y separa:

| Grupo | Tratamiento |
| --- | --- |
| Pendiente válido | Seleccionable. Sin inicio, historial, baseline o registros financieros previos. |
| Ya habilitado | No seleccionable; conserva su inicio, vigencias, cuotas y pagos. |
| Requiere revisión | No seleccionable; incluye inactivos, datos incompletos e históricos. |

El global excluye administradores; su habilitación individual sigue siendo explícita.
La carga debe tener un titular válido por ID. Un titular inactivo no se reactiva por
seleccionar a una carga. La acción **Revisar socio** lleva al detalle existente.

**Seleccionar pendientes** marca únicamente filas elegibles. Antes de aplicar se revisan
selección, mes y total de cuotas; la confirmación deja claro que no representa dinero
recibido. El resultado informa habilitados, omitidos, revisión y errores individuales.

La interfaz procesa bloques de 10, con clave estable por bloque para evitar peticiones
largas en Heroku. El API admite hasta 25 aprobaciones por llamada y vistas previas de
hasta 500 socios. Si una respuesta es incierta, conserva selección/payload y muestra
**Reintentar mismo lote**; no inventa éxito ni revierte socios ya aprobados.

## No reemplazar lo manual con el masivo

El lote reutiliza `BillingAdminService.enroll`, su plan compartido y la transacción
existente. Cada beneficiario se valida otra vez al confirmar. Si se habilitó manualmente
entre la vista previa y el lote, se omite sin modificarlo. Una tarifa/dato cambiado
requiere nueva revisión; no se aceptan importes, roles o estados suministrados por React.

Una solicitud revisada queda identificada en la auditoría existente. Misma clave y
contenido permiten reintentar; otra selección con esa clave se rechaza. Operaciones
concurrentes no duplican cuotas ni aprobaciones. Un error en un socio no revierte los
éxitos de otros y el reintento retoma con las mismas claves. No se agregan colecciones.

La **habilitación masiva** no es el proceso mensual: este último continúa generando
cuotas nuevas según vigencia y aplicando sus reglas aprobadas cuando esté activado.
Ninguno reinicia el mes inicial o borra registros por volver a ejecutarse.

## Qué significa revisar los pilotos

Los dos pilotos ya tenían inicio, cuotas y pagos anteriores al campo `billingPeriods`.
No están sin pagar ni necesitan reinscripción. **Revisar vigencia** presenta el inicio
original derivado del baseline existente, cuotas y pagos que se conservarán.

La aprobación exige administrador activo, motivo y huella del servidor. Añade solo el
primer intervalo de vigencia y su auditoría; conserva inicio, baseline, estado, importes,
cuotas y pagos byte a byte. No crea cuotas, no cobra, no archiva deuda y no cambia tarifas.
Un baseline incompleto, una baja, una vigencia ya existente o un pago realmente incierto
impiden aplicar esa revisión. No se infieren períodos para arreglar datos ambiguos.

## Qué significa el checkout UNKNOWN confirmado

La creación del enlace pudo quedar incierta por una respuesta perdida. Después, el
proveedor confirmó el pago. Eso no convierte un pago verificado en deuda pendiente.

La política compartida prioriza `CONFIRMED` con evidencia: proveedor Mercado Pago,
ID numérico, estado `approved`, verificación y fechas de pago/confirmación. Se aplica
en lotes de revisión, lifecycle, ajustes, bloqueo de intentos solapados y chequeo de
liberación. El metadato `UNKNOWN` se conserva como historia; no se repite el pago.
`PENDING`, `REVIEW_REQUIRED`, evidencia inválida o intentos aún utilizables siguen
requiriendo revisión. No se acepta únicamente una afirmación del navegador.

## Contratos

Rutas bajo `/membership-billing/admin`, JWT y administrador activo en BD:

- `POST /enrollment/preview`: `{ startPeriod, familyMemberId? }`, solo lectura.
- `POST /enrollment`: `{ startPeriod, reason, items: [{ memberId, approvalHash }] }`
  con `Idempotency-Key`; transacciones individuales, sin reemplazos.
- `GET /members/:id/billing-history/preview`, solo lectura.
- `POST /members/:id/billing-history`: `{ approvalHash, reason }` y clave idempotente.

## Pruebas

Unitarias de elegibilidad, tarifas, huellas y evidencia frente a `UNKNOWN`. Integración
HTTP/JWT con replica set local: vista previa sin escrituras, manual versus masivo,
reintentos concurrentes, rechazo de cambios, fallo parcial recuperable y rollback de
auditoría. La revisión antigua conserva cuotas y pagos confirmados, incluso con
metadato histórico incierto; pendientes reales siguen bloqueando la aprobación.

Frontend: selección, omisión de habilitados/inactivos, cancelación SweetAlert2, motivo,
doble clic, partición 10/10/resto y misma clave/payload tras timeout. E2E con frontend,
NestJS y MongoDB locales: carga manual → masivo que la omite → revisión del piloto
pagado. Chrome/WebKit en 320, 390, 820 y 1440 px; no certifica un iPhone físico.

La ejecución de estas pruebas no accede a la base del club ni a credenciales de Heroku.
Despliegue, aprobaciones sobre socios reales y activación general son decisiones separadas.
