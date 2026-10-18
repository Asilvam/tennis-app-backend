# Mensualidades: administracion de pagos bancarios (etapa 3)

Actualizacion posterior: el piloto local ya fue habilitado solo para Usuario test 1 y
Usuario test 2. La configuracion local, alcance sobre Atlas, evidencia y pendientes de
todas las etapas estan en [revision del 17 de octubre](membership-billing-review-2026-10-17.md).
Las referencias de este documento a "no se cambiaron .env/cuentas reales" describen
la entrega original previa a esa habilitacion, no el estado posterior del piloto.

## Implementado

- Pantalla administrativa /adminpayments: busqueda de socios, cuotas, registro bancario,
  historial paginado, filtros de mes/medio/estado y detalle de beneficiarios.
- Transferencia y deposito son medios distintos; un admin no registra un pago bancario
  como Mercado Pago. Titular/carga conservan su imputacion individual.
- Pagador separado del administrador responsable; se admite un pagador externo sin
  crearle una cuenta. Correo solo a pagadores registrados con direccion conocida.
- Cuotas completas, monto recibido igual a la suma seleccionada, primero meses anteriores.
  El formulario calcula ese monto automaticamente y lo muestra de solo lectura; no se
  ingresa manualmente. Cambiar la seleccion exige volver a verificar el ingreso bancario.
  El backend conserva su validacion independiente de igualdad exacta.
  Anticipos: mes actual mas tres futuros; no avanzar la ventana por haber pagado el ultimo.
- Confirmacion explicita de ingreso verificado en banco; fecha efectiva y referencia obligatorias.
- Coincidencia de referencia/fecha/monto con otro pago confirmado: advertencia, segunda
  confirmacion y vinculo auditable al movimiento coincidente. No es una unicidad bancaria global.
- Persistencia transaccional: pago confirmado, cuotas pagadas y auditoria se guardan juntos.
  Si falla una parte, se revierte todo. Indices unicos verificados antes de operaciones de escritura.
- Clave de idempotencia y huella del contenido: un reintento devuelve el mismo registro;
  reutilizar la clave con datos distintos produce conflicto. Dos registros no liquidan la misma cuota.
- Anulacion de un registro bancario con motivo, responsable e idempotencia. Reabre solo
  cuotas vinculadas a ese pago; conserva el original y la auditoria. NO devuelve dinero al banco.
- Avisos de confirmacion/anulacion persistidos en el pago, envio posterior al commit y reintentos
  acotados. Fallar un correo no revierte un pago ni obliga a pagar nuevamente.

Decision confirmada por el usuario durante esta etapa: sin adjuntos de comprobantes por
ahora. Se conservan referencia y observacion, sin reutilizar fotos de perfil para documentos bancarios.

## Contratos HTTP

Prefijo: /membership-billing/admin. Todas las rutas exigen JWT, rol admin en el token,
administrador activo verificado en register y habilitacion explicita del modulo.
actorId/registeredBy/status no son campos elegibles por el cliente.

| Metodo / ruta | Uso |
| --- | --- |
| GET /members | Busqueda literal por nombre/correo, pagina y mes; no genera cuotas |
| GET /members/:id | Detalle del socio y cuotas existentes; solo lectura, sin generar cuotas ni habilitar cuentas |
| POST /members/:id/dues | Preparar y consultar cuotas del socio y cargas vinculadas |
| POST /quote | Revalidar seleccion y calcular importe en backend |
| GET /payments | Historial administrativo por mes, medio, estado o beneficiario |
| POST /payments | Registrar ingreso bancario verificado |
| POST /payments/:id/reversal | Anular registro bancario con motivo |

POST de pago/anulacion requiere Idempotency-Key de 16 a 100 caracteres alfanumericos,
guion o guion bajo. El frontend conserva la misma clave y contenido ante respuesta incierta.
La coincidencia bancaria requiere matchingReferenceVerified=true solo despues de la
segunda confirmacion; el backend deja evidencia de la coincidencia, aunque un admin llame directamente.

No hay rutas nuevas publicas de aprobacion ni endpoints de configuracion/migracion automatica.
La ruta de anulacion no opera sobre Mercado Pago. Su futura conciliacion/reembolso no
forma parte del registro manual bancario.

## Habilitacion y seguridad de despliegue

MembershipBillingModule ahora se importa en AppModule. Sus esquemas mantienen
autoCreate=false y autoIndex=false. Importar el modulo no crea configuracion, indices,
cuotas, pagos ni baselines en una base real.

Dos habilitaciones independientes, inicialmente ausentes/desactivadas:

- Backend: MEMBERSHIP_BILLING_ADMIN_ENABLED=true habilita rutas y avisos pendientes.
- Frontend: el acceso al menu administrativo de mensualidades depende de la sesion y rol admin, sin bandera VITE adicional. La ruta y el backend siguen exigiendo permisos administrativos.

La ruta de React sigue protegida por rol aunque el menu este oculto. Las llamadas directas
al backend deshabilitado reciben 503; ocultar el menu no se utiliza como control de seguridad.

Antes de habilitar sobre datos reales se requieren el inventario y la migracion aprobados:
configuracion valida, indices unicos y billingStartPeriod/baseline explicitamente revisados.
Sin ese inicio no se generan cuotas. No se inicializa ni se factura a socios nuevos/inactivos
por una suposicion. Esas politicas siguen pendientes de decision para su automatizacion.

No se cambiaron .env ni variables de Heroku. No se modificaron cuentas reales, incluidas
usuario test 1 y usuario test 2. Las pruebas crean homonimos ficticios en bases temporales
con IDs de prueba autorizados para tarifas 180/50; no usan nombres como permiso financiero.

autoBlockEnabled sigue desactivado por defecto. El login y las reservas conservan el flujo
actual: el acceso restringido del socio y su conexion al calculo financiero corresponden a etapa 4.
Por tanto, registrar un pago no modifica silenciosamente los booleanos administrativos anteriores.

## Correo y auditoria

- La cola de avisos usa notifications[] dentro de membership_payments; no hay coleccion nueva.
- Trabajador cada 30 segundos, solo con modulo habilitado y para pagos bancarios.
- Lease de 5 minutos para recuperar caidas; hasta 6 intentos con espera exponencial acotada.
- Estados pendientes, en proceso, enviados, fallidos o cancelados visibles en detalle de historial.
- Misma clave de idempotencia en el servicio de correo; no prometer entrega exactamente una
  vez si el receptor no deduplica. Timeout de 15 segundos exclusivo de estas llamadas.
- EmailService acepta un timeout opcional adicional; quienes no lo pasan conservan su contrato.
  Las pruebas de reset/verificacion/reservas siguen aprobadas.
- Plantilla mensual con colores CTQ y datos escapados; no promete habilitacion si hay otras
  deudas o una desactivacion manual.
- Auditoria financiera en audit_logs con entityType=MEMBERSHIP_PAYMENT y evento unico,
  dentro de la misma transaccion. No se reutilizan metodos que oculten un error de auditoria.
- Las consultas antiguas de audit-logs permiten cualquier sesion autenticada: ahora excluyen
  esos eventos financieros. Asi no exponen pagos a otros socios ni alteran reportes de reservas.

## Interfaz

Mejora aprobada posterior: Administrar usuarios incluye la accion Pagos por ID. Abre
el mismo modulo mensual en modo individual, con datos del socio, cuotas propias e
historial filtrado por beneficiario (no por pagador). El historial individual comienza
sin filtro de mes. Registrar un pago conserva el flujo familiar titular/cargas ya existente.
Volver a usuarios restaura la URL de busqueda y la posicion del listado; la ruta de retorno
se limita a /adminregister. No se agregaron colecciones ni una segunda logica de pagos.

Los selectores de esta ventana usan react-select, como Editar usuario, con colores CTQ,
CSS propio y opciones en portal. Controles compactos de 46px, entradas de 16px y foco
dentro del control; no se importan los estilos de Administrar usuarios o categorias.
El filtro de historial combina periodo/beneficiario en la misma imputacion con $elemMatch.

- CSS exclusivo AdminMembershipPayments.css, reutilizando tokens --ctq-* y tipografia actual.
- Fondo y superficies CTQ, texto claro, acento celeste y accion principal amarilla.
- Sin importar CSS de categorias, sin cambios globales de color ni formularios dentro de tarjetas.
- FontAwesome y spinner existentes. Inputs de al menos 16px y objetivos de al menos 44px.
- SweetAlert2 para errores, confirmaciones, coincidencias bancarias, anulacion y salida sin guardar.
- Proteccion existente de navegacion extendida con contexto membership-payment, sin cambiar
  el texto ni comportamiento de categorias/resultados. El cierre nativo de pestana mantiene
  la proteccion del navegador, que no permite reemplazarla por un dialogo personalizado.

## Pruebas y limites

Validacion automatizada de esta entrega:

- Backend: 607 pruebas aprobadas en 43 suites, sin omisiones. Incluye integraciones reales
  con MongoDB replica set local de mensualidades, categorias y resultados.
- Registro bancario por HTTP con JWT real, control de rol desde BD, contrato estricto,
  concurrencia, repeticion de solicitudes, rollback de registro/anulacion y privacidad de auditoria.
- Correo simulado: fallo y recuperacion, lease entre trabajadores y agotamiento tras caida.
- Frontend: 137 pruebas aprobadas, incluidas 21 nuevas de seleccion, payload y reintentos.
- Playwright/Chrome: listado, formulario, SweetAlert de descarte, registro, historial y anulacion
  en 1440x1000, 390x844, 320x740 y 820x1180, con APIs interceptadas. Tambien el flujo de
  referencia repetida. Sin overflow horizontal y sin errores JavaScript.
- TypeScript, compilacion y lint del frontend; compilacion y lint del modulo nuevo del backend.

Los registros bancarios de integracion se guardaron en bases aisladas ctq_billing_test_*.
No representan transferencias reales. Los correos fueron simulados. No se hizo un cobro de
Mercado Pago: su prueba integrada corresponde a etapa 5, con tarifas de prueba y validacion
de importes admitidos por el proveedor. No se ha certificado Safari/teclado en un iPhone fisico.

## Siguientes etapas

1. Etapa 4: portal del socio, historial individual y acceso restringido con guards backend.
2. Etapa 5: checkout/webhook mensual y conciliacion, sin alterar pagos de luz o visitas.
3. Etapa 6: baseline real revisado, piloto de monto bajo y activacion opcional del bloqueo.

No se desplego, no se hizo push ni commit y no se migro o elimino monthpayctq.
