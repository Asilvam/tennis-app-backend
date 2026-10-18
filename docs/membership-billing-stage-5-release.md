# Etapa 5: preparacion de liberacion y prueba real

Estado al 17 de octubre de 2026: despliegue autorizado por el usuario, en preparacion.
Se mantienen develop para frontend/backend y master para Mercado Pago, sin cambiar ramas.
Este documento no ejecuta comandos ni confirma pagos.

## Alcance

- Una cuota de octubre de Usuario test 1, titular, por $180 CLP reales.
- No incluir la cuota de $50 de Usuario test 2 en ese checkout.
- No incorporar otros socios, generar cuotas generales ni activar autoBlockEnabled.
- El usuario completa el pago en Mercado Pago; no se solicitan sus credenciales bancarias.
- Las credenciales de Heroku se consultan solo en memoria, sin copiarlas a archivos.

## Comprobaciones realizadas

- Consulta de solo lectura usando MONGODB_URI de Heroku y la BD Tennis.
- Test 1 activo, Titular, inicio de facturacion 2026-10, cuota OPEN/TEST por $180.
- Cero intentos de pago registrados para Test 1 al preparar este documento.
- Tarifas de prueba habilitadas solo para los IDs de Test 1 y Test 2.
- Cero cuotas de octubre de otros socios; autoBlockEnabled=false.
- Indices unicos de cuota por socio/mes, referencia, idempotencia y pago del proveedor presentes.
- Configuracion interna de Heroku coherente entre backend y Mercado Pago.
- La ultima consulta de rutas mensuales de ambos servicios devolvio 404: falta desplegar.
- Backend: 693 pruebas aprobadas y compilacion correcta en la ultima validacion local.
- Mercado Pago: 121 pruebas aprobadas y compilacion correcta en la ultima validacion local.
- Frontend: 164 pruebas aprobadas, compilacion y lint correctos en esta preparacion.
- Las pruebas automatizadas usan proveedor/correos simulados y base temporal aislada.

## Versiones de referencia

Versiones observadas antes de cualquier cambio; consultar nuevamente antes de desplegar.

| Componente | App Heroku | Version observada |
| --- | --- | --- |
| Backend | app-tenis-qtro-backend-2 | v61 |
| Mercado Pago | mercadopago-service-ctq-2 | v28 |
| Frontend | app-tenis-qtro-2 | v43 |

## Secuencia autorizada

1. Revisar y preparar revisiones Git reproducibles de los tres proyectos. Excluir .env,
   secretos, archivos de QA y cambios ajenos de formato o configuracion. El DTO no usado
   src/mercadopago/dto/membership.dto.ts requiere revision de autoria y no debe incluirse
   automaticamente. Conservar los cambios locales ajenos sin revertirlos.
2. Desplegar primero backend manteniendo el portal sin habilitar. Comprobar salud,
   autenticacion y callback mensual protegido con la clave interna existente.
3. Desplegar Mercado Pago y comprobar la ruta interna de configuracion. No crear una
   preferencia si fallan cuenta, conectividad, webhook HTTPS o autenticacion interna.
4. Desplegar frontend compilado con la URL de backend de produccion existente, no con
   .env local. Confirmar que /monthlypayments carga tambien al entrar directamente.
5. Habilitar el portal y su administracion en backend bajo la autorizacion del despliegue. No cambiar tarifas,
   autoBlockEnabled ni inicio de facturacion de otros socios. El control financiero
   aprobado afecta login/reservas y conserva la restriccion financiera legada.
6. Verificar regresion de login, reset, categorias, reservas, luz/visitas y acceso admin.
7. Entrar como Test 1, seleccionar exclusivamente octubre propio y comprobar total $180.
   Revalidar cuota OPEN y ausencia de intentos en curso antes de iniciar un unico checkout.
8. Crear el enlace y verificar cuenta, CLP, importe y modo real. Si queda UNKNOWN o hay
   timeout, consultar/conciliar la misma referencia, sin crear otro intento a ciegas.
9. El usuario completa el pago. El retorno del navegador no confirma el dinero.
10. Verificar webhook firmado, procesamiento durable y confirmacion contra evidencia
    fresca del proveedor. Comprobar una sola imputacion, cuota PAID, pago CONFIRMED,
    auditoria, correo y visibilidad correcta en historial del socio y administrador.
11. Comprobar que Test 2 conserve su cuota de $50 sin pagar y que no aparezcan cuotas
    ni cambios de acceso para el resto del club. Documentar solo referencias operativas
    necesarias, nunca tokens, claves o informacion bancaria.

## Criterio de cierre

La etapa 5 se acepta solo despues del pago real autorizado y la verificacion completa
de persistencia, webhook, historial y correo. La liberacion general sigue siendo etapa 6.

## Recuperacion ante fallos

- Antes de crear un checkout: detener la prueba y corregir el despliegue/configuracion
  con autorizacion; conservar las versiones anteriores como referencia de recuperacion.
- Despues de crear un checkout: mantener funcionando webhook, callback y conciliacion
  para esa referencia. No borrar intentos, pagos o cuotas ni fingir confirmaciones.
- No revertir a codigo sin callback mensual mientras exista un checkout utilizable o
  un pago incierto. Evaluar primero el estado real del proveedor y la compatibilidad.
- Un fallo de correo no revierte el pago confirmado: verificar su reintento separado.
- Revertir codigo no revierte dinero, datos ni variables de entorno. No modificar ni
  eliminar registros financieros como mecanismo de rollback.
