# Cierre de cambios locales de mensualidades

Fecha: 2026-11-01. Punto 2 del listado de pendientes del usuario; no confundir
con la etapa 2 futura de generacion automatica/manual. Repositorios originales
tennis-app-backend y tennis-court-front, rama develop, Node 22.19.0/npm 10.9.3.

## Alcance revisado

- Login de cuenta activa con deuda permitido. Inactividad sigue rechazando
  acceso. El menu conserva todas las rutas autorizadas por rol; no fuerza pagos.
- El backend revalida el permiso en nuevas reservas, holds, checkout de reserva
  y multibooking. Sin JWT devuelve 401; sin permiso, RESERVATION_BLOCKED/403.
  La UI usa canReserve y SweetAlert2; no reemplaza la validacion del servidor.
- Consultar permisos no genera cuotas. Los periodos vencidos sin cuota emitida
  se tratan como revision requerida, no como pago supuesto ni baja automatica.
- Editar socio consulta estado financiero privado. Pago al dia se muestra
  apagado y no editable ante cuotas vencidas de un socio no exento. Mover ese
  indicador no registra dinero, no anula cuotas ni elimina deuda.
- Tipo de socio queda alineado con Correo; selector de titular aparece debajo
  al elegir Carga. Ofrece titulares activos y conserva una referencia previa
  no vigente sin seleccionar otro socio silenciosamente.
- Automatizacion global permite editar generacion recurrente y bloqueo de
  reservas por mora. Requiere administrador activo, revision vigente, validacion
  del backend y auditoria transaccional; confirmaciones SweetAlert2 sin guardar
  optimistamente ni reintentar en silencio un cambio global incierto.
- La baja automatica tiene un control independiente; no se enciende al activar
  generacion y su ausencia equivale a desactivada. No se agrega control UI de baja.

Los cambios funcionales ya estaban en el arbol local: se revisaron sus contratos
y se repitio la regresion. No se agregaron reglas nuevas al negocio en este cierre.

## Validacion ejecutada

| Comprobacion | Resultado |
| --- | --- |
| Backend Jest completo | 916 pruebas / 58 suites; cero fallos y cero omitidas |
| Integraciones incluidas | 198 casos en 7 suites con MongoDB aislado |
| Frontend Node | 324 pruebas; cero fallos y cero omitidas |
| Compilacion backend/frontend | Aprobada |
| Tipos frontend | tsc -b aprobado |
| Lint frontend | Aprobado |
| Lint semantico backend, 14 archivos revisados | Sin errores ni warnings |
| Automatizacion E2E | 78 comprobaciones, 6 vistas |
| Permisos E2E | 54 comprobaciones, 6 vistas |
| Editor/selector de titular E2E | 210 comprobaciones, 12 vistas |

E2E total: 342 comprobaciones, 24 combinaciones Chromium/WebKit en movil,
tablet y escritorio. APIs interceptadas y socios ficticios; no llamadas al club.
El build frontend utilizo VITE_API_URL=https://api.ctq-fixture.invalid.

MongoDB 8.0.34 se descargo desde el archivo oficial ya registrado por las pruebas
anteriores y se verifico SHA-256. Proceso temporal en 127.0.0.1:27377, replica set
ctqPoint2, directorio nuevo y bases ctq_billing_test_*, ctq_category_test_* y
ctq_results_test_*. Al terminar no quedaban bases de prueba y se detuvo mongod.
No se instalo un servicio, no se importo AppModule contra .env ni se uso Atlas.

### Limite de lint

El lint backend completo del alcance no queda verde por formato: 16 diferencias
Prettier con el printWidth local 240 y 124 con el printWidth versionado 120.
No se ocultaron esos reportes ni se reformatearon archivos enteros. El informe
separado de reglas semanticas desactiva solo prettier/prettier y da cero errores.
El ajuste local de .prettierrc se excluye de los commits de este punto.

## Commits y exclusiones

Se separan backend y frontend. Se incluyen codigo, pruebas y documentacion del
alcance. Se excluyen .env reales, cambios de reinstalacion de lockfiles, archivos
de formato sin cambio funcional, documentos del worker retirado y copias Node24.
La eliminacion local del toast de bienvenida del login no es necesaria para
mensualidades y tampoco se incluye; se conservan solo sus cambios de permisos.

Este cierre no activa generacion, bloqueo o bajas en la base del club; tampoco
registra cuotas/pagos, modifica tarifas, despliega o publica commits remotos.
La etapa siguiente de generacion del dia 1/modo estrictamente manual y su
recuperacion sigue pendiente. Tambien queda la aceptacion en iPhone/iPad fisico
y cualquier piloto/despliegue autorizado por separado.

Evidencia reproducible: [validation.json](evidence/membership-close/validation.json)
y reportes de integracion, lint y navegador en el mismo directorio.
