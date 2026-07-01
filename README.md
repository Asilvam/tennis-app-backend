# Club de Tenis Quintero - API Backend (NestJS + MongoDB)

<p align="center">
  <a href="https://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
  <img src="https://img.shields.io/badge/Node.js-v18+-339933?style=flat&logo=node.js&logoColor=white" alt="Node Version" />
  <img src="https://img.shields.io/badge/MongoDB-Mongoose-47A248?style=flat&logo=mongodb&logoColor=white" alt="MongoDB Mongoose" />
  <img src="https://img.shields.io/badge/Mercado%20Pago-Ecosistema-00B1EA?style=flat" alt="Mercado Pago" />
  <img src="https://img.shields.io/badge/Swagger-API%20Docs-85EA2D?style=flat&logo=swagger&logoColor=black" alt="Swagger API Docs" />
</p>

## 📋 Descripción General

Este es el backend principal del **Club de Tenis Quintero**, desarrollado con el framework progresivo **NestJS** y **MongoDB (Mongoose)**. Administra las reservas de canchas, el registro de socios, el ranking de jugadores y, más recientemente, la gestión de pagos de mensualidades integrada de forma desacoplada con **Mercado Pago**.

---

## 💳 Sistema de Pago de Mensualidades (`month-pay-ctq`)

El módulo `month-pay-ctq` permite a los socios registrar y regularizar sus mensualidades directamente a través de la plataforma web. Soporta dos modalidades:
1. **Titular ($18.000 CLP):** Pago mensual del socio principal, el cual habilita directamente su cuenta.
2. **Familiar / Carga ($5.000 CLP):** Pago mensual para un familiar dependiente, el cual se selecciona dinámicamente desde un menú desplegable y habilita la cuenta de dicha carga familiar de forma individual.

### 📐 Flujo de Operación y Conciliación de Pagos

El sistema funciona de forma asíncrona y segura mediante webhooks:

```
[ Frontend ] --(1) Inicia pago (DTO)--> [ Backend (initiate) ]
                                                |
                                      (Genera idPayment de 15 chars
                                      y guarda registro 'pending')
                                                |
                                        (2) Llama microservicio MP
                                                |
[ MP Portal ] <--(3) Retorna Pasarela -- [ Microservicio MP ]
      |
(Usuario Paga)
      |
[ Webhook MP ] --(4) Notificación de Aprobación --> [ Microservicio MP (Callback) ]
                                                              |
                                                    (Valida external_reference
                                                     y redirige según origen)
                                                              |
                                                              v
[ Backend (approve/:idPayment) ] <--(5) POST Webhook Aprobado --+
      |
(Actualiza status a 'approved' en 'monthpayctq')
      |
(Habilita la cuenta del Titular o Carga: updatePayment: true)
      |
(6) Envía confirmación por Correo Electrónico
```

---

## 🔒 Validación de Estado de Pago ("Pago al Día")

### ¿Dónde y cómo se valida que un socio esté al día?

El backend maneja la elegibilidad del jugador a través de la propiedad booleana `updatePayment` dentro de la colección `Register` (Mongoose Entity):
* **`updatePayment: true`** -> El socio está habilitado para iniciar sesión y reservar canchas.
* **`updatePayment: false`** -> El socio está bloqueado por falta de pago y no puede iniciar sesión ni realizar reservas.

Esta validación se ejecuta estrictamente en los siguientes puntos clave del backend:

1. **Control de Inicio de Sesión (Login)**
   * **Archivo:** [auth.service.ts](file:///Users/alejandrosilvamonsalve/Documents/Developer/tennis-app-backend/src/auth/auth.service.ts#L33-L35)
   * **Comportamiento:** Durante el proceso de autenticación, después de validar la contraseña, se verifica `user.updatePayment`. Si es `false`, se lanza un `UnauthorizedException('user blocked for no payment')`, impidiendo el acceso a la plataforma.

2. **Verificación de Bloqueo (Check Blocked Status)**
   * **Archivo:** [auth.service.ts](file:///Users/alejandrosilvamonsalve/Documents/Developer/tennis-app-backend/src/auth/auth.service.ts#L105-L111)
   * **Método:** `checkIfUserIsBlocked(email: string)`
   * **Comportamiento:** Cualquier flujo crítico (como reservar canchas) consulta si el jugador está bloqueado. Un usuario se considera bloqueado si su estado administrativo `statePlayer` es `false` **O** si `updatePayment` es `false`.

3. **Habilitación Dinámica tras Aprobación de Pago**
   * **Archivo:** [month-pay-ctq.service.ts](file:///Users/alejandrosilvamonsalve/Documents/Developer/tennis-app-backend/src/month-pay-ctq/month-pay-ctq.service.ts#L89-L96)
   * **Método:** `approvePayment(idPayment: string)`
   * **Comportamiento:** Cuando Mercado Pago confirma el pago con éxito a través del webhook:
     - Si el tipo de pago es `Titular`, el sistema recupera el email del pagador y ejecuta `registerService.enablePlayerPayment(email)` para marcar `updatePayment = true`.
     - Si el tipo de pago es `Familiar`, el sistema recupera el email de la carga (`emailCarga`) y actualiza individualmente la cuenta del dependiente con `updatePayment = true`, manteniendo la independencia de ambos estados.

---

## 🚀 Endpoints de la API (`month-pay-ctq`)

### 1. Iniciar Pago de Mensualidad
* **Ruta:** `POST /month-pay-ctq/initiate`
* **Descripción:** Crea un registro de pago con estado `pending`, genera un ID compacto único de 15 caracteres (`uuidv4().replace(/-/g, '').substring(0, 15)`) y genera la preferencia de Mercado Pago llamando al microservicio.
* **Cuerpo de la Petición (Payload):**
  ```json
  {
    "email": "socio@gmail.com",
    "paymentType": "Titular", 
    "amount": 18000,
    "monthToPay": "05-2026",
    "emailCarga": "opcional_carga@gmail.com"
  }
  ```
* **Respuesta Exitosa (201):**
  ```json
  {
    "preferenceId": "PREFERENCE_ID_MERCADOPAGO",
    "initPoint": "https://www.mercadopago.cl/sandbox/payments/checkout..."
  }
  ```

### 2. Obtener Historial de Pagos
* **Ruta:** `GET /month-pay-ctq/history/:email`
* **Descripción:** Retorna el historial cronológico descendente de pagos realizados por un socio.
* **Respuesta Exitosa (200):**
  ```json
  [
    {
      "idPayment": "a1b2c3d4e5f6g7h",
      "namePlayer": "Juan Pérez",
      "email": "juan@gmail.com",
      "paymentType": "Familiar",
      "amount": 5000,
      "monthToPay": "05-2026",
      "emailCarga": "hijo@gmail.com",
      "status": "approved",
      "createdAt": "2026-05-27T02:00:00.000Z"
    }
  ]
  ```

### 3. Aprobar Pago de Mensualidad (Webhook Callback)
* **Ruta:** `POST /month-pay-ctq/approve/:idPayment`
* **Descripción:** Endpoint llamado tras una transacción exitosa para marcar la mensualidad como aprobada y habilitar la vigencia del titular o carga.
* **Respuesta Exitosa (200):**
  ```json
  {
    "idPayment": "a1b2c3d4e5f6g7h",
    "status": "approved",
    ...
  }
  ```

### 4. Confirmación por Correo Electrónico
* **Ruta:** `POST /month-pay-ctq/emailconfirmation`
* **Descripción:** Envía un comprobante estilizado y dinámico de confirmación de mensualidad al correo del pagador, especificando el tipo de membresía, el mes pagado, el monto en CLP y el estado del beneficio.
* **Cuerpo de la Petición:**
  ```json
  {
    "reservationId": "a1b2c3d4e5f6g7h",
    "paymentStatus": "approved"
  }
  ```

---

## 🛠️ Configuración e Instalación

### Requisitos Previos
* **Node.js** (Versión 18 o superior)
* **MongoDB** (Local o URI Atlas)
* **Microservicio Mercado Pago** corriendo de forma paralela

### Variables de Entorno (`.env`)
Asegúrate de configurar las siguientes variables de entorno en el archivo `.env` en la raíz del backend:

```env
PORT=3500
MONGO_URI=mongodb+srv://...
JWT_SECRET=tu_clave_secreta_jwt
MP_API_URL=http://localhost:3002/mercadopago  # Ruta base del microservicio Mercado Pago
```

### Ejecutar el Servidor
```bash
# Instalar dependencias
$ npm install

# Modo desarrollo
$ npm run start:dev

# Compilar producción
$ npm run build

# Ejecutar producción
$ npm run start:prod
```

---

## 📘 Documentación Swagger API Interactive

El backend cuenta con documentación interactiva integrada de Swagger para pruebas locales y remotas.

* **URL de Acceso en Desarrollo:** [http://localhost:3500/docs](http://localhost:3500/docs)

* **Endpoints Decorados:**
  - `month-pay-ctq`: Todos los flujos de inicio de pago, historial, aprobación y confirmación de correos.
  - `email`: Herramientas de envío de correos.
  - `court-reserve`: Reservas y disponibilidad de canchas de tenis.

---

## 📄 Licencia

Este proyecto es privativo y de uso exclusivo para el **Club de Tenis Quintero**.
