# Branch Scope

Branch: `feature/notification-persistence`

## Purpose

This branch upgrades push notifications from in-memory handling to persisted subscriptions with safer delivery behavior.

## Includes

- `src/notification/notification.service.ts`
- `src/notification/notification.controller.ts`
- `src/notification/dto/`

## Excludes

- Monthly payment flow
- Broad Swagger/DTO documentation changes
- New Relic or formatting-only changes
