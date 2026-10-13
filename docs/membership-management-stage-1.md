# Socios y mensualidades: etapa 1

## Implementado localmente

- `partnerType` acepta Titular, Carga y el valor histórico Familiar.
- `titularId` referencia el `_id` estable del titular en `register`, con un índice no único.
- La edición administrativa permite elegir Titular/Carga y seleccionar un titular para la carga.
- `PATCH /register/admin/:email` exige JWT con rol admin; solo acepta nombre, celular, rol, estado activo, indicador de pago, tipo de socio y titular.
- El front envía únicamente campos modificados, nunca contraseña, token de verificación, email ni `_id`.
- El socio seleccionado debe existir y ser Titular. No se permiten autoasociaciones ni cadenas de cargas como titulares.
- Antes de convertir un titular con cargas en Carga, deben reasignarse esas cargas.
- Convertir una Carga en Titular elimina su asociación anterior.
- Los registros históricos Familiar sin titular se conservan. Editar su nombre u otros datos no fuerza una migración; al completar la asociación se guardan como Carga.
- El registro público no asigna `titularId` ni acepta campos administrativos. La ruta de perfil exige JWT del propietario y solo admite nombre, celular y fotografía; no permite cambiar tipo ni asociación.

Las asociaciones usan transacciones y un cambio de versión del titular para impedir una asignación simultánea con su conversión en carga. Esto requiere MongoDB con soporte de transacciones (replica set o clúster fragmentado), no una instancia standalone. Ver [transacciones MongoDB](https://www.mongodb.com/docs/manual/core/transactions/).

## Fuera de esta etapa

Todavía no se crean cuotas, pagos, tarifas maestras, recibos ni automatismos de bloqueo por mensualidades. No se modifican `statePlayer` o `updatePayment` al cambiar el tipo de socio; siguen siendo los controles administrativos actuales, editables explícitamente en el formulario.

Las reglas acordadas para las siguientes etapas son:

- Mes calendario; titular $18.000 CLP y carga $5.000 CLP, configurados en una colección maestra.
- Cuota e historial propios por socio, aunque otra persona pague.
- El titular puede seleccionar su cuota y todas o algunas de las cuotas de sus cargas.
- La carga puede pagar individualmente su mensualidad.
- Un administrador puede registrar depósitos confirmados para titulares o cargas, con referencia, fecha, importe, comprobante y observaciones.
- Un pago agrupado mantiene el detalle por cuota, mes y beneficiario. El pagador y el administrador que registra son datos distintos.
- No borrar pagos para corregirlos; correcciones auditadas. Cuotas completas inicialmente, sin abonos parciales.

## Prueba local y despliegue

Coordinar backend y front: la edición administrativa usa la nueva ruta, y la subida/actualización de fotografía ahora requiere JWT en ambas llamadas. El front antiguo que no envía esos encabezados recibirá `401`. No hay cambios en Mercado Pago, correo ni variables de entorno en esta etapa. No se modifica ningún socio automáticamente ni se ejecuta una migración masiva.

1. Iniciar sesión como admin con backend y front locales conectados a Mongo de pruebas con replica set.
2. Editar un socio, seleccionar Carga y elegir un Titular distinto. Guardar y volver a abrir para comprobar la asociación.
3. Cambiarlo nuevamente a Titular y comprobar que desaparece la asociación.
4. Intentar convertir en Carga un titular con cargas: debe rechazarse hasta reasignarlas.
5. Editar solo el nombre de un Familiar antiguo sin titular: debe conservar sus datos históricos.
6. Confirmar que cambiar el tipo no altera su rol, estado activo ni indicador de pago, salvo que también se editen explícitamente.

## Protección acordada antes del flujo de pagos

Se protegieron las rutas antiguas de edición y habilitación/bloqueo de pago. Solo un admin autenticado puede editar rol, estado activo e indicador de pago. El alta pública acepta una lista limitada de datos y el servicio asigna los permisos, incluso si recibe campos adicionales en una llamada interna.

Se mantiene la política previa de alta: usuario normal, inactivo hasta verificación y con `updatePayment=true`. No se debe confundir ese indicador con un historial financiero verificado; la mensualidad todavía no está implementada.

El hallazgo de `resetpass` se resolvió posteriormente mediante [recuperación con enlace](password-recovery.md): el usuario o un admin solicitan un enlace temporal; solo quien lo confirma elige la nueva contraseña. Las sesiones JWT previas se conservan hasta vencer, según lo acordado. Los endpoints de lectura públicos no se protegieron globalmente; no presentar estas mejoras puntuales como una auditoría global de seguridad terminada.
