# Mensualidades: portal y Mercado Pago

## Alcance implementado

- Portal propio y cargas vinculadas: cuotas completas, meses consecutivos desde el mas antiguo, mes actual mas tres futuros e historial individual.
- Inicio de checkout con IDs de cuotas y clave de idempotencia. El servidor calcula importes, beneficiarios y tarifas; el navegador no confirma pagos.
- Intento PENDING antes de llamar al proveedor. Un timeout conserva UNKNOWN y la referencia: no hay segundo checkout automatico.
- Microservicio conserva Checkout Pro, firma e inbox existentes, pero separa el proposito MEMBERSHIP de luz/visitas. No se crearon otras colecciones.
- Confirmacion por evidencia fresca del proveedor: operacion, referencia, cuenta receptora, modo, CLP, tarifa e importe exacto. Cuotas, pago, auditoria y aviso pendiente se registran en una transaccion.
- Duplicados, discrepancias, cuotas pagadas por banco, devoluciones y contracargos quedan en revision sin abonar dos veces ni reabrir cuotas automaticamente.
- Aviso por correo posterior a confirmacion; su fallo no revierte el pago. Reintentos y auditoria separados.
- Administracion muestra medio, operacion del proveedor, monto recibido y motivos de revision. Mercado Pago no se anula como un registro bancario.

## Permisos aprobados

El usuario aprobo expresamente conectar identidad y permisos financieros en login y reservas con pruebas de JWT, permisos y regresion.

- Portal habilitado: socio activo con restriccion financiera puede ingresar solo a mensualidades; backend impide reservar, retener un turno, iniciar pago de reserva o usar multibooking.
- Inactividad administrativa siempre prevalece; un pago no cambia statePlayer ni updatePayment.
- Administradores activos exentos de deuda. Una firma JWT con rol antiguo no reemplaza el rol actual de BD.
- Restriccion por deuda se calcula solo cuando autoBlockEnabled esta aprobado/activo. Sigue false en el piloto.
- Un bloqueo financiero legado updatePayment=false requiere revision administrativa expresa; registrar un pago no borra ese antecedente automaticamente.
- Callback de mensualidades exige clave interna; los callbacks de reservas conservan sus propios guards. Rutas publicas de lectura legadas no se convirtieron en privadas en este alcance.

## Activacion

1. Mantener el piloto por IDs: usuario test 1 y usuario test 2. Inicialmente ambos eran Titular ($180). Posteriormente el usuario cambio test 2 a Carga de test 1: se respeta su tipo actual y tarifa $50. No cambiar asociaciones automaticamente para preparar pruebas.
2. Configuracion financiera, indices unicos y baseline solo de esos socios ya revisados; no generar deuda para los demas.
3. Portal: MEMBERSHIP_PORTAL_ENABLED=true en backend. El front no necesita banderas de mensualidades: consulta permisos financieros al servidor y muestra la administracion segun el rol de la sesion. El backend valida todos los accesos y habilita o rechaza los pagos.
4. Antes de cobros: desplegar backend y microservicio nuevos con autorizacion. No apuntar mensualidades a un webhook antiguo que solo conoce reservas.
5. El microservicio verifica la cuenta chilena con /users/me usando el token existente y obtiene el modo de la preferencia del proveedor. Backend conserva esa evidencia y exige coincidencia al confirmar. TEST es tarifa, no modo sandbox; sandbox no liquida cuotas STANDARD.
6. Reutilizar MP_API_URL e INTERNAL_API_KEY en backend, BACKEND_URL y NOTIFICATION_URL publica HTTPS en microservicio. El retorno de mensualidades reutiliza el dominio de MP_SUCCESS_URL con la ruta /monthlypayments. No hay variables de URL especificas ni overrides para mensualidades.
7. No hay bandera adicional de Mercado Pago mensual: backend consulta la disponibilidad del microservicio por una ruta interna autenticada, sin crear cobros. Al desplegar ambos servicios y configurar correctamente las conexiones existentes, el checkout puede quedar disponible. Las confirmaciones no dependen de esa consulta de disponibilidad. No usar la base real de inbox al levantar workers locales de prueba.
8. Usuario completa una operacion real de $180, comprobar webhook firmado, recibo, cuotas, auditoria y correo. Confirmar compatibilidad del proveedor con $50 antes de probar una Carga real autorizada. No aumentar importes sin acuerdo.

## Verificacion y pendientes

Pruebas automatizadas en MongoDB replica set local aislado, sin cobros ni correos reales: checkout, concurrencia, confirmacion, idempotencia, privacidad, JWT, callbacks, bloqueo/restablecimiento de reservas y correo. Regresion incluye reservas simples, holds, multibooking, luz/visitas y categorias.

QA Playwright con API/proveedor simulados en 1440, 820, 390 y 320 px: seleccion consecutiva, titular/carga $230, retorno manipulado que no confirma, consulta de pago, historial por medio, carga propia y acceso restringido. Regresion de pagos bancarios desde usuarios.

No se ejecutaron pagos reales, despliegues, commits ni push. Etapa 5 no se considera aceptada de extremo a extremo hasta realizar el pago real con callback publico actualizado. Etapa 6 (migracion general y posible bloqueo automatico) permanece pendiente de aprobacion.

Resultado final: 673 pruebas backend, 112 microservicio y 149 frontend aprobadas; compilacion de los tres proyectos correcta. ESLint del front y de los modulos nuevos correcto. El lint de Auth conserva un conflicto de formato preexistente entre .prettierrc del usuario (240 columnas) y max-len (120); no se cambio esa configuracion ajena.

Validacion inicial del portal local con ambos IDs de prueba: entonces ambos eran Titular $180, cuotas OPEN, sin nuevos pagos. Ese resultado precede al cambio de test 2 a Carga descrito abajo. El bloqueo automatico sigue desactivado; Mercado Pago requiere servicios actualizados y configuracion existente verificada, sin otra bandera.

## Ajuste por cambio de tipo (17 de octubre)

Al cambiar Titular/Carga desde administracion, las cuotas OPEN del mes actual y posteriores se ajustan en la misma transaccion que el socio, conservando sus IDs y una auditoria de antes/despues con administrador autenticado. Los meses anteriores y todas las cuotas PAID conservan su importe. No se generan cuotas nuevas al editar.

Los campos de precio siguen siendo inmutables para el resto de las operaciones: solo el servicio de ajuste permite esta excepcion transaccional auditada. Un checkout pendiente, incierto, en revision o aun utilizable bloquea el cambio completo para no alterar un importe que ya puede cobrarse. Fallos de auditoria revierten tambien la edicion del socio. No se cambia implicitamente de tarifa TEST a STANDARD ni se recalculan pagos historicos.

Caso detectado: test 2 ya era Carga, pero su cuota OPEN de octubre conservaba el snapshot TITULAR y $180. La reparacion se ejecuta por la misma ruta administrativa para llevarla a CARGA/$50, sin tocar test 1 ($180), estados de acceso ni pagos. Total de las dos cuotas: $230.

Reparacion aplicada y auditoria verificada. Cuotas ya generadas de noviembre/diciembre de test 2 a $50 se conservaron sin cambios. Regresion completa: 689 pruebas backend aprobadas (48 suites), incluida concurrencia con checkout y rollback por fallo de auditoria; compilacion y lint del nuevo servicio correctos.

## Simplificacion de configuracion de Mercado Pago

Se retiraron las tres variables mensuales de habilitacion, collector y modo de ambos servicios y sus ejemplos. Se reutilizan las credenciales y conexiones existentes. La consulta de disponibilidad es interna, autenticada y de solo lectura; si falla, el portal mantiene disponible el historial pero no ofrece iniciar un checkout. La cuenta se verifica con /users/me; el modo se obtiene de la preferencia unica del proveedor y se contrasta con el pago. No se deduce del prefijo del token.

Las confirmaciones siguen verificando evidencia fresca, importe, CLP, referencia y cuenta, aunque falle la consulta de disponibilidad. Los pagos sandbox no liquidan cuotas STANDARD. No se agregaron nuevas variables para reemplazar las retiradas. Permanecen las dos banderas de backend para administracion y portal; su retiro no forma parte de este cambio.

Verificacion posterior: 693 pruebas backend y 121 del microservicio aprobadas; ambas compilaciones y lint del modulo mensual y archivos modificados del microservicio correctos. Proveedor y correos simulados, MongoDB local aislado para integraciones. No se hicieron cobros, cambios en Heroku ni despliegues; sigue pendiente la prueba real autorizada de extremo a extremo.
