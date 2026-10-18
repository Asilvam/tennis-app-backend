# Mensualidades: habilitacion local y revision de etapas

Fecha: 2026-10-17. Rama backend/front: develop. Sin despliegue ni commit.

## Entorno verificado

- Front habitual: http://localhost:5173/adminpayments, menu Mensualidades para admin.
- Backend: http://localhost:3500/membership-billing/admin.
- El backend LOCAL usa Atlas, base Tennis. No equivale a una BD aislada.
- Front: `.env.development.local` habilita el menu solo en desarrollo.
- Backend: `.env` local con MEMBERSHIP_BILLING_ADMIN_ENABLED=true; Nest watch recargado.
- No se cambiaron variables de Heroku ni del microservicio Mercado Pago.

## Alcance realmente aplicado

Se ejecutaron vista previa, respaldo exclusivo y transaccion del comando
`scripts/membership-billing-pilot.cjs`. No se ejecuta al iniciar la aplicacion.

- Creadas las tres colecciones previamente aprobadas: membership_billing_config,
  membership_dues y membership_payments, con indices aditivos, sin syncIndexes ni borrados.
- Auditoria de configuracion en audit_logs; se preservaron indices/eventos anteriores.
- Solo dos cuentas quedaron con billingStartPeriod=2026-10 y baseline hasta 2026-09:
  Usuario test 1 (68ca0d7dbe61eb1818ed0256), Usuario test 2 (69db05e350b53dd24160517d).
- Ambos ya eran Titular. No se cambiaron tipos, asociaciones, roles, claves ni estados.
- Lista de tarifas TEST limitada por ID a esas dos cuentas: titular 180, carga 50 CLP.
  Por su tipo actual, ambos tienen cuota de prueba de 180, no 50.
- Tarifas STANDARD configuradas: titular 18000, carga 5000 CLP. Ningun otro socio
  fue incorporado a facturacion ni recibio cuotas.
- Bloqueo automatico desactivado. Migracion general NO marcada como revisada.
- Dos cuotas OPEN de octubre preparadas por la API local, una por cuenta de prueba.
- No se registro un ingreso bancario ficticio, no se realizo un cargo Mercado Pago,
  no se enviaron correos de pago ni se eliminaron registros legados.
- Inventario previo: 148 register, 0 incorporados a facturacion mensual, monthpayctq vacio.

Respaldo previo acotado a configuracion y campos de los usuarios de prueba:
`/private/tmp/ctq-monthly-pilot-before-20261017.json` (permisos 0600).
No contiene credenciales de conexion ni contrasenas.

## Estado por etapa

| Etapa | Estado comprobado | Pendiente real |
| --- | --- | --- |
| 1. Diseno | Aprobado; reglas y contratos contrastados con implementacion | Decisiones de altas/reactivaciones/cambio de tipo no se inventan |
| 2. Backend financiero | Implementado y verificado con MongoDB replica set | Migracion general separada, no automatica |
| 3. Administrador | Habilitado LOCAL con dos cuentas; API/UI y regresion verificadas | Verificacion de un ingreso bancario real cuando exista; no fingirlo como prueba |
| 4. Portal del socio | NO implementado | Cuotas/historial propios, seleccion familiar y acceso restringido, guards de reservas, responsive y pruebas |
| 5. Mercado Pago mensual | NO implementado | Checkout mensual, webhook verificado, conciliacion, reintentos y pago real de monto bajo |
| 6. Piloto y activacion general | Solo preparacion controlada de dos cuentas | Recorrido completo tras 4/5, revision del baseline general, despliegue y activacion opcional por separado |

La revision de todas las etapas NO implica que esten implementadas. No se integran
los guards financieros en login/reservas ni se activa el bloqueo anticipadamente.
La rama antigua feature/monthly-payments no se fusiona: el modelo actual sustituye
su propuesta, conservando monthpayctq hasta una migracion/retiro revisados.

## Evidencia

- Backend: 625 pruebas aprobadas, 44 suites, 0 fallos, 0 omitidas. Integraciones en
  bases ctq_*_test_* de MongoDB LOCAL, no en Atlas.
- Incluye 13 pruebas de protecciones del piloto: IDs/nombres, rol activo, idempotencia,
  rechazo de baseline/configuracion ajenos, rechazo de facturacion fuera del piloto,
  conservacion de tarifas y bloqueo desactivado.
- API REAL localhost:3500: admin 200, anonimo 401, socio comun 403, consulta y
  preparacion de dos cuotas de octubre, quotes de 180, historial 200.
- Navegador Chrome contra API REAL: escritorio 1440x1000, movil 390x844 e iPad
  820x1180: busqueda, formulario TEST, volver e historial, sin overflow horizontal.
- Autenticacion de QA temporal en contexto de navegador desechable; sin tokens en
  archivos ni sustitucion de la sesion del navegador del usuario.
- Todas las solicitudes de registro bancario y otros cambios quedan bloqueadas
  en esta comprobacion visual real. El flujo completo bancario se prueba en bases aisladas.
- TypeScript backend y lint del modulo nuevos verificados.
- Frontend: 145 pruebas aprobadas y lint correcto. Recorrido completo con APIs
  simuladas de transferencia, historial y anulacion en escritorio, 390px, 320px e iPad.
- Segunda ejecucion APPLY del inicializador: sin nuevas altas ni cambios de configuracion.
  Verificacion posterior en Atlas: 148 socios, 2 incorporados al piloto, 0 ajenos
  incorporados, 2 cuotas OPEN/TEST de octubre a 180, 0 pagos y un unico evento de setup.
- No certifica teclado/Safari en dispositivos fisicos ni aprobacion de un pago real.

## Mejora aprobada: pagos desde Administrar usuarios

- Accion Pagos en cada socio: /adminpayments?memberId=ID, reutilizando el modulo.
- Nombre completo, tipo y estado, cuotas propias, historial por beneficiario y registro
  bancario familiar. Inactivos/no incorporados se pueden consultar sin habilitarlos.
- Endpoint GET /membership-billing/admin/members/:id es de solo lectura. Ver una
  ficha no modifica cuentas, no genera cuotas y no crea auditorias de pagos ficticios.
- El historial individual inicia con todos los meses. Periodo y beneficiario deben
  coincidir en una misma imputacion, incluso en pagos familiares con meses distintos.
- Selectores react-select con CSS exclusivo, misma paleta de Editar usuario; menu
  oscuro y acento celeste, sin opciones nativas grises. Controles de 46px con foco interno.
- Retorno seguro a Usuarios conserva busqueda, parametros y scroll. No existe paginacion
  propia en el listado actual de usuarios; no se agrego una para esta mejora.
- Cinco pruebas backend nuevas: consulta sin escrituras, consulta de inactivos/no
  incorporados, permisos/IDs, beneficiario distinto de pagador y filtros por imputacion.
- Cuatro pruebas frontend nuevas: ruta por ID, retorno/busqueda/scroll, destinos seguros
  y valores invalidos de navegacion.
- Cuatro pruebas adicionales del monto automatico: total titular/carga, seleccion vacia,
  meses consecutivos/desmarcado y duplicados. Campo de monto de solo lectura; el
  navegador verifica que cambiar cuotas borra la confirmacion de ingreso bancario.
- Chrome con APIs simuladas: recorrido Usuarios -> detalle -> deposito -> historial ->
  anulacion -> Usuarios en 1440x1000, 390x844, 320x740 y 820x1180. Conserva scroll exacto.
- Contra backend real: accion de Usuario test 1, detalle de octubre, selector CTQ,
  historial individual y regreso con busqueda preservada, en escritorio/movil/iPad.
- Sin pagos bancarios nuevos en Atlas, sin nuevas tablas ni cambios al bloqueo general.

## Comando operativo

Desde el backend, simulacion por defecto:

```sh
node scripts/membership-billing-pilot.cjs \
  --admin-id 66b81ccd2583eb6b6628f224 \
  --member-id 68ca0d7dbe61eb1818ed0256 \
  --member-id 69db05e350b53dd24160517d
```

Para aplicar exige `--apply --backup /ruta/exclusiva.json`. El archivo no puede existir,
debe guardarse privadamente y el plan se revalida dentro de la transaccion. Si encuentra
otro baseline, otras tarifas o cuentas ajenas facturadas se detiene, no las reescribe.
No usar este comando para desplegar a todos los socios.

No eliminar pagos para deshacer una prueba: anulacion auditada para pagos bancarios;
reembolso de Mercado Pago requiere su flujo propio. No retirar configuracion/baselines
si ya tienen movimientos dependientes sin una revision especifica.
