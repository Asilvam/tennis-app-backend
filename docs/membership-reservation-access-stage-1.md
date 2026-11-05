# Etapa 1: identidad, reservas y controles de mensualidades

Fecha: 2026-10-31. Implementacion local sobre `develop`, sin activacion de produccion.

## Alcance aprobado

- Activo apagado sigue impidiendo login; no pago ya no equivale a cuenta inactiva.
- Pago al dia apagado bloquea nuevas reservas, no ver el sitio ni ingresar resultados.
- Una deuda vencida no puede eludirse encendiendo ese indicador manual.
- Separar generacion, bloqueo por deuda y baja automatica, sin nuevas variables de entorno.
- Mantener tarifas, pagos, historial, orden de pago y evidencia existente.

## Contrato de acceso

`BillingPortalService.permissions()` devuelve `canReserve`, `reason`, estado activo,
periodos e importe vencidos, bloqueo manual y exencion automatica del administrador.
`financiallyRestricted` permanece por compatibilidad: representa una restriccion
de reserva, no una instruccion para expulsar al usuario o reducir toda la navegacion.

| Situacion | Login | Lecturas/acciones ajenas a crear reservas | Nuevas reservas |
| --- | --- | --- | --- |
| Activo y habilitado | Si | Segun rol y permisos existentes | Si |
| Activo, indicador manual de pago apagado | Si | Segun rol | No |
| Activo con deuda vencida y `autoBlockEnabled` activo | Si | Segun rol | No |
| Administrador activo, solo con deuda automatica | Si | Segun rol | Exento de ese bloqueo |
| Administrador con indicador manual apagado | Si | Segun rol | No; el bloqueo manual es independiente |
| Cuenta inactiva | No | Se mantienen los guards de actividad | No |
| Configuracion financiera no verificable al login | Si, si identidad/clave/actividad son validas | Segun rol y disponibilidad | No se concede permiso; `BILLING_UNAVAILABLE` |

Si la cuenta pasa a inactiva durante la comprobacion de permisos, no se oculta
la denegacion de identidad. Un fallo financiero no se trata como un pago confirmado.

`MembershipAccessGuard` verifica las nuevas reservas y sus entradas de pago:
`POST /court-reserve`, `/court-reserve/holds`, `/court-reserve/admincreate`,
`/court-reserve/adminreserve`, `/booking/multiple`, `/mp/init-point`, y
`PATCH /court-reserve/holds/:id`. Una denegacion devuelve `403` y
`code: RESERVATION_BLOCKED`. Los roles administrativos se siguen comprobando
con el estado actual del socio, no solo con un claim firmado.

El guard no usa una lista de paginas permitidas para deudores. Verificar actividad
no depende de Mercado Pago ni de la configuracion de tarifas en lecturas normales.
Cancelaciones existentes, consulta de resultado de pago y callbacks internos
conservan sus contratos y autorizaciones. Los callbacks mantienen su API key.

El indicador manual se aplica incluso si el portal de mensualidades esta apagado;
no se usa su flag para eludir controles de reserva. Administradores siguen
exentos de mora automatica, no de una restriccion manual explicita.

## Cuotas ausentes y lecturas sin emision

`assessFinancialAccess()` deja de crear cuotas. Calcula desde registros y periodos
de vigencia. Si falta un mes facturable cuyo vencimiento ya paso, informa
`missingPeriods` y `billingReviewRequired`. Con bloqueo automatico activo se
deniega reserva por `BILLING_DUES_REVIEW`; no se inventa un saldo ni un pago.
Una ausencia no se interpreta como estar al dia.

Esto no elimina toda la preparacion bajo demanda: el portal de cuotas, cotizacion
y endpoint administrativo de compatibilidad todavia tienen sus generadores.
La consolidacion de modo manual/automatico pertenece a la etapa 2; no se afirma
que apagar el cron ya detenga todas las rutas de emision.

## Tres controles persistidos, sin nuevas variables

| Campo en `membership_billing_config` | Responsabilidad |
| --- | --- |
| `automation.enabled` | Generacion recurrente de cuotas |
| `autoBlockEnabled` | Denegar reservas por mora desde el primer mes vencido |
| `automation.terminationEnabled` | Baja por tres vencidas; requiere habilitacion independiente |

`terminationEnabled` es nuevo en el mismo documento, no una coleccion ni variable
de entorno. Ausente significa **false**: una configuracion anterior con solo
`automation.enabled: true` ya no basta para ejecutar bajas. Antes de desplegar,
revisar si se desea conservar alguna baja automatica previamente aprobada y
aprobar esa nueva opcion explicitamente. Esta tarea no escribe esa configuracion.

Generacion o baja activas requieren la revision/aprobacion existente del modulo.
La tarea horaria se reutiliza; no se agrega otro scheduler. La conciliacion previa
a bajas solo se ejecuta si las bajas estan habilitadas. Una baja sin generacion
no puede basarse en meses no emitidos: queda en `MISSING_DUES_REQUIRE_REVIEW`.
El informe de liberacion tambien detecta bajas activas aunque generacion este apagada.

La separacion inicial no habilito opciones de Heroku ni una interfaz de edicion.
La ampliacion solicitada el 1 de noviembre agrega dos controles en la administracion
global existente: [API, auditoria y pruebas](membership-automation-controls.md).
No incluye un control de baja automatica ni activa opciones sobre datos reales.

## Frontend

- Login no fuerza `/monthlypayments` por deuda. Se conservan retornos de pago seguros.
- Navegacion muestra todas las entradas autorizadas por rol.
- `MembershipSessionBoundary` solo resuelve el retorno seguro de un login ya
  autenticado; no redirige perfil, ranking, historial o resultados por deuda.
- Dashboard y modal consultan el permiso antes de abrir/confirmar una reserva;
  multi-booking impide enviar. Avisos mediante SweetAlert2, sin cambios de paleta.
- `AuthContext` refresca `canReserve` al enfocar, recuperar visibilidad y en su
  intervalo existente. `403 RESERVATION_BLOCKED` actualiza permiso, sin logout.
  No se depende del estado visual: la API vuelve a comprobar antes de reservar.
- Al confirmar un pago se conserva el refresco de permisos existente. Un bloqueo
  manual apagado no se enciende silenciosamente por pagar otra deuda.

### Editar usuario

Nueva lectura privada `GET /membership-billing/admin/members/:id/access`, con
JWT, guard admin y revalidacion de administrador activo. Devuelve resumen del
socio elegido sin generar cuotas ni consultar al proveedor.

El formulario consulta ese resumen al abrir. Ante cuota vencida, muestra periodos
e importe; el indicador Pago al dia se ve apagado y no se puede usar para tapar
esa deuda. No se sobrescribe `updatePayment` al leer: conserva el bloqueo manual
independiente. Activo no se altera. La respuesta tardia de otro editor se descarta.
Si el resumen falla, se informa que no se verifico; el servidor conserva sus
controles aunque se guarde un cambio manual del indicador.

No se agregan importes o saldos al `GET /register` publico. La lectura ocurre
solo para el editor seleccionado, no una peticion por cada fila. El listado
existente no se convierte en un reporte financiero completo en esta etapa.

## Compatibilidad y pendientes

- Coordinar publicacion de backend y frontend. El nuevo contrato evita el modo
  `PAYMENTS_ONLY`; un frontend anterior podria seguir redirigiendo por el campo
  de compatibilidad, y un backend anterior mantiene el bloqueo amplio.
- Revertir el backend a la version anterior tambien vuelve a acoplar bajas con
  `automation.enabled`. No hacer rollback con generacion activa sin revisar ese
  efecto y la configuracion; el flag nuevo no protege a codigo antiguo que lo ignora.
- Sin migraciones financieras, cambios de tarifa, nuevos pagos ni correos.
- Se conserva mes vencido: octubre impago restringe desde el 6 de noviembre;
  noviembre puede pagarse junto con octubre o despues, sin saltar el anterior.
- Etapa 2: consolidar generacion del dia 1, modo manual, idempotencia y recuperacion.
- Etapa 3: piloto, respaldo, despliegue y activacion explicita; no incluidos aqui.
