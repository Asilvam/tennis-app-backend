# Recuperación de contraseña con enlace

## Flujo implementado en local

1. Un usuario sin sesión solicita recuperación desde `/recuperar-contrasena`, enlazado en el login. Un administrador puede iniciar la misma solicitud desde administración.
2. El backend genera 32 bytes aleatorios criptográficos y guarda su hash SHA-256, vencimiento y control de solicitudes en el documento del socio. No persiste el token original ni cambia su contraseña.
3. El correo contiene un enlace a `/restablecer-contrasena#token=...`. El fragmento no se envía como URL de la solicitud al servidor del front.
4. El usuario elige y confirma su nueva contraseña. El front elimina el fragmento de la barra de direcciones y conserva el token únicamente en memoria mientras se completa el formulario; recargar la página requiere volver a abrir el enlace original.
5. El backend valida el token y el vencimiento, calcula bcrypt y revalida el vencimiento al actualizar. Cambiar la contraseña y consumir el token son una sola operación atómica sobre el documento.
6. Se envía una notificación del cambio, sin contraseña ni token. No se inicia sesión automáticamente.

Vigencia: **15 minutos** para solicitudes públicas y **24 horas** para las solicitudes de administración (incluido el botón de Admin usuarios). El backend decide el plazo según la ruta autenticada; el cliente no puede elegirlo. El correo muestra el plazo correspondiente. Una confirmación exitosa invalida el enlace, incluso ante dos solicitudes concurrentes. Un nuevo enlace aceptado reemplaza al anterior. Recuperar contraseña no modifica rol, tipo de socio, verificación de correo, `statePlayer` ni `updatePayment`; tampoco permite evadir sus bloqueos.

Por decisión explícita, los JWT ya emitidos **siguen vigentes hasta su vencimiento**. Esta mejora no incorpora refresh tokens ni revocación de sesiones.

## Contratos

| Ruta | Autorización | Datos |
| --- | --- | --- |
| `POST /register/password-recovery` | Pública | `{ "email": "socio@example.com" }` |
| `POST /register/resetpass` | Pública; alias seguro para clientes anteriores | Igual solicitud; ya no cambia ni devuelve la contraseña |
| `POST /register/admin/resetpass` | JWT admin | Igual solicitud |
| `POST /register/password-recovery/confirm` | Token de recuperación, no JWT de sesión | `{ "token": "64 caracteres hex", "password": "...", "passwordConfirmation": "..." }` |

Las solicitudes válidas reciben el mismo mensaje genérico exista o no el correo. También se conserva esa respuesta cuando se limita el reenvío o falla su entrega; no confirma que un correo haya sido entregado. Campos adicionales y datos inválidos reciben `400`; las rutas admin usan `401/403`.

Solo se generan enlaces persistidos para correos existentes con `statePlayer=true`; no se envían enlaces a cuentas inactivas, tampoco desde administración. `updatePayment` no se usa para decidir el envío y no cambia con la recuperación.

El control público es persistente y atómico: **una solicitud aceptada cada 24 horas**, contando desde la última solicitud, no desde medianoche. El administrador autenticado usa una ruta diferente y no tiene ese límite de tiempo, pero siempre requiere una cuenta activa. El cuerpo público no permite activar la excepción administrativa. Cada enlace nuevo invalida el anterior y queda registrado como la última solicitud aceptada para esa cuenta.

Se ejecuta la misma consulta para cuentas desconocidas y se aplica un tiempo mínimo de respuesta de 250 ms; esto reduce diferencias de tiempo habituales, pero no garantiza tiempos idénticos ante latencia variable de Mongo. No se añadió limitación global por IP ni se cambió la confianza en proxies.

La entrega del correo queda fuera del tiempo de respuesta público. Si falla, se invalida únicamente ese enlace y la contraseña permanece igual; **se conserva el límite de 24 horas**, según la decisión acordada. No hay cola durable de correo en esta etapa: si el proceso se reinicia antes de entregar el mensaje, el usuario debe esperar el intervalo de reenvío o solicitar ayuda al administrador. Una notificación fallida después de confirmar no deshace el cambio de contraseña.

Los metadatos de recuperación tienen `select:false`, de modo que no aparecen en las lecturas normales de perfiles o socios. El índice del hash es sparse, **no TTL**: nunca se deben borrar socios por vencimiento de un enlace.

## Configuración y despliegue

Nueva variable del **backend**, ya configurada para la prueba local:

```dotenv
PASSWORD_RESET_FRONTEND_URL=http://localhost:5173/restablecer-contrasena
```

En producción debe ser la URL HTTPS del front con esa ruta. No acepta credenciales, query ni fragmento predefinidos; no toma el destino del request o de encabezados enviados por el cliente. Si falta o no es segura, la solicitud devuelve `503`, sin cambiar la cuenta.

Coordinar backend y front. El nuevo front usa `password-recovery`, no el endpoint antiguo, para no activar un cambio inmediato de contraseña si se publica antes del backend compatible. El alias antiguo del backend actualizado solicita un enlace seguro.

Las plantillas HTML se generan en este backend. `email-send-microservice` mantiene el mismo contrato `POST /email/send`; no requiere cambios de código o variables. Mercado Pago no se modifica. No se cambiaron variables de Heroku.

## Pruebas

```bash
npm test -- --runInBand --runTestsByPath src/register/password-recovery.service.spec.ts src/register/password-recovery.controller.spec.ts
```

Incluyen permisos HTTP, respuesta genérica, ausencia de contraseña en respuestas, hashes, vencimiento antes y después de bcrypt, consumo concurrente, datos inválidos, errores de correo, filtro de cuentas activas y ocultamiento de metadatos. La validación real con Mongo 8 aislada aprobó ocho comprobaciones: límite de 24 horas y su frontera, excepción administrativa, cuentas inactivas y desconocidas, conservación del límite tras fallo de envío, doce solicitudes públicas concurrentes, dos confirmaciones concurrentes y ocultamiento de datos privados. Se usaron cuentas ficticias y correo simulado, sin leer `.env` ni acceder a Mongo de producción.

Las pantallas usan las superficies oscuras del login y acentos ámbar para advertir que se está solicitando o confirmando un cambio de contraseña. Usuario y administrador ven avisos distintos, coherentes con sus límites. La confirmación común indica que se revise el vencimiento del correo, sin asumir quince minutos para enlaces emitidos por administración.

Para revisar manualmente, usar cuentas y correo de pruebas: abrir el login, solicitar recuperación, seguir el enlace, confirmar y comprobar que el enlace no puede reutilizarse. Repetir desde administración. Los JWT previos continúan válidos según la decisión acordada.
