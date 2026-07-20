# Frontend Chat Integration Guide

## Base

Base URL:

```txt
http://localhost:3000/api
```

Semua request yang butuh auth wajib kirim header:

```http
Authorization: Bearer <SUPABASE_ACCESS_TOKEN>
```

Untuk chat, FE sebaiknya selalu kirim `timezone`, contoh:

```json
{
  "timezone": "Asia/Jakarta"
}
```

## Send Chat Message

```bash
curl -X POST "http://localhost:3000/api/chats/messages" \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Buatin jadwal meeting besok jam 3 sore",
    "timezone": "Asia/Jakarta"
  }'
```

Field penting dari response:

```txt
parsed.type
assistantMessage.id
requiresConfirmation
proposal
scheduleUpdateProposal
scheduleDeleteProposal
studyPlanProposal
studyPlanUpdateProposal
studyPlanDeleteProposal
studyPlanConflict
isNeedMoreData
```

## Need More Info

Kalau:

```json
{
  "parsed": {
    "type": "need_info",
    "content": "..."
  },
  "isNeedMoreData": true
}
```

FE cukup tampilkan `parsed.content` sebagai bubble assistant.

Tidak perlu tampilkan tombol accept.

## Create Normal Schedule

Response:

```json
{
  "parsed": {
    "type": "schedule_proposal"
  },
  "requiresConfirmation": true,
  "proposal": {},
  "schedule": {
    "id": "...",
    "status": "PENDING"
  }
}
```

FE tampilkan preview schedule dan tombol accept.

Accept:

```bash
curl -X POST "http://localhost:3000/api/chats/messages/ASSISTANT_MESSAGE_ID/accept" \
  -H "Authorization: Bearer TOKEN"
```

Gunakan `assistantMessage.id`, bukan `schedule.id`.

## Update Normal Schedule

Response:

```json
{
  "parsed": {
    "type": "schedule_update_proposal",
    "scheduleId": "...",
    "summary": "...",
    "description": null,
    "location": null,
    "startDateTime": "2026-07-22T15:00:00+07:00",
    "endDateTime": "2026-07-22T16:00:00+07:00"
  },
  "requiresConfirmation": true,
  "scheduleUpdateProposal": {}
}
```

FE tampilkan preview perubahan dan tombol accept.

Accept:

```bash
curl -X POST "http://localhost:3000/api/chats/messages/ASSISTANT_MESSAGE_ID/accept-schedule-update" \
  -H "Authorization: Bearer TOKEN"
```

Saat accept:

- schedule row di-update
- `status` jadi `ACCEPTED`
- kalau schedule punya `googleCalendarEventId`, backend coba sync update ke Google Calendar

## Delete Normal Schedule

Response:

```json
{
  "parsed": {
    "type": "schedule_delete_proposal",
    "scheduleId": "...",
    "summary": "..."
  },
  "requiresConfirmation": true,
  "scheduleDeleteProposal": {}
}
```

FE tampilkan konfirmasi delete dan tombol accept.

Accept:

```bash
curl -X POST "http://localhost:3000/api/chats/messages/ASSISTANT_MESSAGE_ID/accept-schedule-delete" \
  -H "Authorization: Bearer TOKEN"
```

Saat accept:

- schedule row dihapus
- kalau schedule punya `googleCalendarEventId`, backend coba delete event di Google Calendar

## Create Study Plan

Response:

```json
{
  "parsed": {
    "type": "study_plan_proposal"
  },
  "requiresConfirmation": true,
  "studyPlanProposal": {}
}
```

FE tampilkan preview study plan dan tombol accept.

Accept:

```bash
curl -X POST "http://localhost:3000/api/chats/messages/ASSISTANT_MESSAGE_ID/accept-study-plan" \
  -H "Authorization: Bearer TOKEN"
```

Saat accept:

- study plan dibuat
- schedules dari study plan dibuat
- schedule status langsung `ACCEPTED`

## Update Study Plan

Response:

```json
{
  "parsed": {
    "type": "study_plan_update_proposal",
    "studyPlanId": "..."
  },
  "requiresConfirmation": true,
  "studyPlanUpdateProposal": {}
}
```

FE tampilkan preview perubahan study plan dan tombol accept.

Accept:

```bash
curl -X POST "http://localhost:3000/api/chats/messages/ASSISTANT_MESSAGE_ID/accept-study-plan-update" \
  -H "Authorization: Bearer TOKEN"
```

Saat accept:

- study plan di-update
- schedule lama milik study plan itu dihapus
- schedule baru dibuat
- schedule baru langsung `ACCEPTED`

## Delete Study Plan

Response:

```json
{
  "parsed": {
    "type": "study_plan_delete_proposal",
    "studyPlanId": "...",
    "title": "..."
  },
  "requiresConfirmation": true,
  "studyPlanDeleteProposal": {}
}
```

FE tampilkan konfirmasi delete dan tombol accept.

Accept:

```bash
curl -X POST "http://localhost:3000/api/chats/messages/ASSISTANT_MESSAGE_ID/accept-study-plan-delete" \
  -H "Authorization: Bearer TOKEN"
```

Saat accept:

- study plan dihapus
- schedule yang linked ke study plan ikut kehapus lewat cascade

## Study Plan Conflict

Kalau jadwal study plan bentrok, response bisa seperti ini:

```json
{
  "parsed": {
    "type": "study_plan_conflict",
    "content": "...",
    "conflicts": [],
    "options": []
  },
  "requiresConfirmation": false,
  "studyPlanConflict": {}
}
```

FE tampilkan:

- `parsed.content`
- daftar `conflicts`
- opsi dari `options`

Opsi yang mungkin muncul:

```txt
skip_day_and_extend
change_time_for_day
```

Kalau user pilih salah satu opsi, kirim lagi sebagai chat message biasa.

Contoh:

```bash
curl -X POST "http://localhost:3000/api/chats/messages" \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "skip aja dan extend",
    "timezone": "Asia/Jakarta"
  }'
```

Setelah itu agent akan bikin proposal baru. FE baru tampilkan tombol accept kalau `requiresConfirmation === true`.

## FE Rules

- Untuk semua accept endpoint, selalu pakai `assistantMessage.id`.
- Jangan accept kalau `requiresConfirmation === false`.
- Kalau `isNeedMoreData === true`, tampilkan pertanyaan dan tunggu user jawab.
- Schedule biasa yang generated dari study plan tidak boleh di-update lewat `accept-schedule-update`; update study plan-nya.
- `timezone` sebaiknya selalu dikirim dari client.
- JSON enum values jangan diterjemahkan di FE payload, contoh: `BEGINNER`, `BALANCED`, `MONDAY`.

## Accept Endpoint Summary

```txt
POST /api/chats/messages/:messageId/accept
POST /api/chats/messages/:messageId/accept-schedule-update
POST /api/chats/messages/:messageId/accept-schedule-delete
POST /api/chats/messages/:messageId/accept-study-plan
POST /api/chats/messages/:messageId/accept-study-plan-update
POST /api/chats/messages/:messageId/accept-study-plan-delete
```
