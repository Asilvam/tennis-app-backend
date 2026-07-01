# 📋 Colección Completa de Curls - Tennis App API
## Variables de Entorno
```bash
BASE_URL=http://localhost:3000
JWT_TOKEN=your_jwt_token_here
EMAIL=usuario@ejemplo.com
PASSWORD=password123
PLAYER_NAME=Juan Perez
RESERVE_ID=your_reserve_id
```
---
## 🔐 1. AUTHENTICATION
### 1.1 Login
```bash
curl -X POST "http://localhost:3000/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "usuario@ejemplo.com",
    "password": "password123"
  }'
```
### 1.2 Refresh Token
```bash
curl -X POST "http://localhost:3000/auth/refreshToken" \
  -H "Content-Type: application/json" \
  -d '{
    "token": "your_jwt_token"
  }'
```
### 1.3 Validate Token
```bash
curl -X POST "http://localhost:3000/auth/validateToken" \
  -H "Content-Type: application/json" \
  -d '{
    "token": "your_jwt_token"
  }'
```
### 1.4 Check Blocked
```bash
curl -X POST "http://localhost:3000/auth/checkBlocked" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "usuario@ejemplo.com"
  }'
```
### 1.5 Verify Email
```bash
curl -X GET "http://localhost:3000/auth/verify-email?token=verification_token"
```
---
## 🎾 2. COURT RESERVES
### 2.1 Create Reserve
```bash
curl -X POST "http://localhost:3000/court-reserve" \
  -H "Content-Type: application/json" \
  -d '{
    "dateToPlay": "2026-03-25",
    "court": "Cancha 1",
    "turn": "18:15-20:00",
    "player1": "Juan Perez",
    "player2": "Jugador 2",
    "isDouble": false,
    "isVisit": false,
    "isPaidNight": false,
    "isForRanking": false
  }'
```
### 2.2 Admin Create Reserve
```bash
curl -X POST "http://localhost:3000/court-reserve/admincreate" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer \$JWT_TOKEN" \
  -d '{
    "dateToPlay": "2026-03-25",
    "court": "Cancha 1",
    "turn": "18:15-20:00",
    "player1": "Admin Player 1",
    "player2": "Admin Player 2",
    "isDouble": false,
    "isVisit": false,
    "isPaidNight": false,
    "isForRanking": false
  }'
```
### 2.3 Admin Reserve Multiple
```bash
curl -X POST "http://localhost:3000/court-reserve/adminreserve" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer \$JWT_TOKEN" \
  -d '[
    {
      "dateToPlay": "2026-03-25",
      "court": "Cancha 1",
      "turn": "18:15-20:00",
      "player1": "Jugador 1",
      "player2": "Jugador 2",
      "isDouble": false,
      "isVisit": false,
      "isPaidNight": false,
      "isForRanking": false
    }
  ]'
```
### 2.4 Update State Reserve
```bash
curl -X POST "http://localhost:3000/court-reserve/UpdateStateReserve/reserve_id_123" \
  -H "Authorization: Bearer \$JWT_TOKEN"
```
### 2.5 Send Email Confirmation
```bash
curl -X POST "http://localhost:3000/court-reserve/emailconfirmation" \
  -H "Content-Type: application/json" \
  -d '{
    "reservationId": "reserve_id_123",
    "paymentStatus": "approved"
  }'
```
### 2.6 Get Available Courts by Date
```bash
curl -X GET "http://localhost:3000/court-reserve/available/2026-03-25"
```
### 2.7 Get Active Reserves by Player
```bash
curl -X GET "http://localhost:3000/court-reserve/active/Juan%20Perez"
```
### 2.8 Get History Reserves by Player
```bash
curl -X GET "http://localhost:3000/court-reserve/history/Juan%20Perez"
```
### 2.9 Export Filtered Reserves to Excel
```bash
curl -X GET "http://localhost:3000/court-reserve/filtered-reserves/excel" \
  -H "Authorization: Bearer \$JWT_TOKEN" \
  --output reserves.xlsx
```
### 2.10 Get Filtered Reserves
```bash
curl -X GET "http://localhost:3000/court-reserve/filtered-reserves" \
  -H "Authorization: Bearer \$JWT_TOKEN"
```
### 2.11 Get All Reserves
```bash
curl -X GET "http://localhost:3000/court-reserve" \
  -H "Authorization: Bearer \$JWT_TOKEN"
```
### 2.12 Update Reserve
```bash
curl -X PATCH "http://localhost:3000/court-reserve/reserve_id_123" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer \$JWT_TOKEN" \
  -d '{
    "player2": "Nuevo Jugador 2",
    "isDouble": true
  }'
```
### 2.13 Delete Reserve
```bash
curl -X DELETE "http://localhost:3000/court-reserve/reserve_id_123" \
  -H "Authorization: Bearer \$JWT_TOKEN"
```
---
## 📊 3. AUDIT LOGS
### 3.1 Get Audits by Reserve ID
```bash
curl -X GET "http://localhost:3000/audit-logs/reserve/reserve_id_123" \
  -H "Authorization: Bearer \$JWT_TOKEN"
```
### 3.2 Get Audits by Date Range
```bash
curl -X GET "http://localhost:3000/audit-logs/date-range?start=2026-03-01&end=2026-03-31" \
  -H "Authorization: Bearer \$JWT_TOKEN"
```
### 3.3 Get Audits - CREATE
```bash
curl -X GET "http://localhost:3000/audit-logs/action/CREATE" \
  -H "Authorization: Bearer \$JWT_TOKEN"
```
### 3.4 Get Audits - DELETE
```bash
curl -X GET "http://localhost:3000/audit-logs/action/DELETE" \
  -H "Authorization: Bearer \$JWT_TOKEN"
```
### 3.5 Get Audits - STATE_CHANGE
```bash
curl -X GET "http://localhost:3000/audit-logs/action/STATE_CHANGE" \
  -H "Authorization: Bearer \$JWT_TOKEN"
```
### 3.6 Get Audits - PAYMENT_CONFIRMATION
```bash
curl -X GET "http://localhost:3000/audit-logs/action/PAYMENT_CONFIRMATION" \
  -H "Authorization: Bearer \$JWT_TOKEN"
```
### 3.7 Get Audits by User
```bash
curl -X GET "http://localhost:3000/audit-logs/user/Juan%20Perez" \
  -H "Authorization: Bearer \$JWT_TOKEN"
```
### 3.8 Cancellation Report
```bash
curl -X GET "http://localhost:3000/audit-logs/report/cancellations" \
  -H "Authorization: Bearer \$JWT_TOKEN"
```
### 3.9 Cancellation Report (Date Range)
```bash
curl -X GET "http://localhost:3000/audit-logs/report/cancellations?start=2026-03-01&end=2026-03-31" \
  -H "Authorization: Bearer \$JWT_TOKEN"
```
### 3.10 Creation Report
```bash
curl -X GET "http://localhost:3000/audit-logs/report/creations" \
  -H "Authorization: Bearer \$JWT_TOKEN"
```
### 3.11 Creation Report (Date Range)
```bash
curl -X GET "http://localhost:3000/audit-logs/report/creations?start=2026-03-01&end=2026-03-31" \
  -H "Authorization: Bearer \$JWT_TOKEN"
```
### 3.12 General Stats (30 days)
```bash
curl -X GET "http://localhost:3000/audit-logs/stats?days=30" \
  -H "Authorization: Bearer \$JWT_TOKEN"
```
---
## 📋 RESUMEN
**Total de Endpoints: 81**
Archivos disponibles:
1. **insomnia-complete.json** - Colección completa (81 endpoints)
2. **insomnia-audit-logs.json** - Solo audit logs (14 endpoints)
3. **insomnia-auth-complete.json** - Solo auth (7 endpoints)
