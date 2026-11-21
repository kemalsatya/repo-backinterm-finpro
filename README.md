# Finpro Ticketing Backend

Backend penjualan tiket event dengan kuota terbatas. Sistem menahan kuota selama 15 menit untuk pesanan yang belum dibayar, membatasi maksimal 4 tiket per pembeli per event, dan menerbitkan tiket berkode unik setelah pembayaran disimulasikan.

## Stack

| Lapisan        | Teknologi                   |
| -------------- | --------------------------- |
| Runtime        | Bun                         |
| HTTP framework | Hono                        |
| Query builder  | Kysely                      |
| Database       | PostgreSQL                  |
| Auth           | JWT (HS256), via `hono/jwt` |
| Validasi       | Zod + `@hono/zod-validator` |
| Lint & format  | Biome                       |

## Struktur Repo

| Path                          | Isi                                                                 |
| ----------------------------- | ------------------------------------------------------------------- |
| `src/modules/auth`            | Login dan penerbitan token                                          |
| `src/modules/events`          | Event publik dan pembuatan order                                    |
| `src/modules/organizer`       | Endpoint khusus penyelenggara                                       |
| `src/modules/orders`          | Riwayat, detail, pembayaran, pembatalan, dan sweeper kedaluwarsa    |
| `src/db`                      | `schema.sql`, koneksi Kysely, seed, dan tipe hasil codegen          |
| `src/config`                  | Pembacaan environment dan pembuatan token                           |
| `tests/unit`                  | Test tanpa database                                                 |
| `tests/integration`           | Test API terhadap PostgreSQL sungguhan                              |
| `local/`                      | Catatan kerja lokal, tidak dipakai runtime dan tidak ikut di-commit |
| `.github/workflows/ci-cd.yml` | Pipeline test, lint, typecheck, dan build image                     |

## Prasyarat

- Docker dan Docker Compose
- Opsional, untuk pengembangan tanpa container: Bun 1.4+

## Menjalankan Sistem

Seluruh sistem (API dan database) hidup dengan satu perintah.

```bash
cp .env.example .env
```

Isi `.env` minimal `POSTGRES_USER`, `POSTGRES_PASSWORD`, dan `POSTGRES_DB`. Nilai contoh di `.env.example` sudah bisa dipakai langsung:

```dotenv
POSTGRES_USER=postgres
POSTGRES_PASSWORD=password
POSTGRES_DB=finpro_ticket_project
PORT=8500
```

Lalu jalankan:

```bash
docker compose up --build
```

API tersedia di `http://localhost:8500`. Service `app` menunggu database sehat sebelum start.

Skema database dibuat otomatis. Berkas `src/db/schema.sql` dipasang ke `/docker-entrypoint-initdb.d` dan hanya dijalankan saat direktori data Postgres masih kosong. Untuk membangun ulang database dari nol:

```bash
docker compose down
rm -rf pgdata
docker compose up --build
```

## Data Demo (Seed)

Seed **tidak** berjalan otomatis, karena berada di balik profile `seed`. Jalankan setelah database siap:

```bash
docker compose --profile seed run --rm seed
```

Seed bersifat idempoten dan mengisi:

| Data           | Nilai                   |
| -------------- | ----------------------- |
| User organizer | `organizer@example.com` |
| User buyer     | `buyer@example.com`     |
| Event          | "Demo Concert", Jakarta |
| Tiket REGULER  | 100 kursi, harga 150000 |
| Tiket VIP      | 20 kursi, harga 500000  |

## Auth

Auth dibuat seadanya sesuai ketentuan tugas: **login hanya butuh email dan role, tanpa password**. Endpoint ini hanya mengidentifikasi pembeli, bukan mengamankan akun. Lihat [`DECISIONS.md`](./DECISIONS.md) bagian Auth untuk pembahasan risikonya.

```bash
curl -s -X POST http://localhost:8500/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"buyer@example.com","role":"buyer"}'
```

Respons berisi token JWT dengan masa berlaku 30 menit:

```json
{
    "success": true,
    "data": "<token>"
}
```

Simpan token itu dan kirim sebagai `Authorization: Bearer <token>` pada endpoint yang butuh autentikasi.

## Cara Menandai Pesanan Lunas

Pembayaran disimulasikan lewat endpoint `POST /api/orders/:orderId/pay`. Endpoint ini memvalidasi bahwa pesanan masih `pending` dan belum lewat 15 menit, lalu menerbitkan tiket. Alur lengkap dari nol:

### 1. Login sebagai buyer

```bash
TOKEN=$(curl -s -X POST http://localhost:8500/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"buyer@example.com","role":"buyer"}' | jq -r .data)

echo "$TOKEN"
```

### 2. Lihat event dan sisa kuota

```bash
EVENT_ID=33333333-3333-4333-8333-333333333333

curl -s http://localhost:8500/api/events/$EVENT_ID
```

Respons memuat `ticket_types` dengan `quota`, `reserved`, dan `remaining` per tipe:

```json
{
    "success": true,
    "message": "Event retrieved",
    "data": {
        "id": "33333333-3333-4333-8333-333333333333",
        "title": "Demo Concert",
        "ticket_types": [
            { "name": "REGULER", "price": 150000, "quota": 100, "reserved": 0, "remaining": 100 },
            { "name": "VIP", "price": 500000, "quota": 20, "reserved": 0, "remaining": 20 }
        ]
    }
}
```

### 3. Buat pesanan

Total tiket dalam satu pesanan harus 1 sampai 4, dan tiap tipe hanya boleh muncul sekali.

```bash
ORDER_ID=$(curl -s -X POST http://localhost:8500/api/events/$EVENT_ID/orders \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"orders":[{"type_name":"VIP","quantity":2}]}' | jq -r .data.id)

echo "$ORDER_ID"
```

`reserved` pada tipe tiket terkait langsung bertambah, dan pesanan berstatus `pending` dengan `expires_at` 15 menit ke depan.

### 4. Tandai lunas

```bash
curl -s -X POST http://localhost:8500/api/orders/$ORDER_ID/pay \
  -H "Authorization: Bearer $TOKEN"
```

Respons memuat status `paid`, `paid_at` terisi, dan tiket berkode unik pada setiap item:

```json
{
    "success": true,
    "message": "Order paid, tickets issued",
    "data": {
        "id": "<order-id>",
        "status": "paid",
        "paid_at": "2026-11-21T10:05:00.000Z",
        "items": [
            {
                "ticket_type_name": "VIP",
                "quantity": 2,
                "unit_price": 500000,
                "tickets": [{ "seq": 1, "code": "TKT-<uuid>" }, { "seq": 2, "code": "TKT-<uuid>" }]
            }
        ]
    }
}
```

Memanggil `pay` dua kali untuk pesanan yang sama akan dibalas `410 ORDER_NOT_PENDING`; tiket tidak pernah terbit dua kali.

Untuk membatalkan pesanan sebelum dibayar, panggil `POST /api/orders/:orderId/cancel`. Kuota langsung kembali tersedia.

## Cara Menjalankan Test

```bash
bun test
```

- Test **unit** selalu berjalan dan tidak butuh database.
- Test **integration** otomatis di-skip bila `TEST_DATABASE_URL` tidak diset, jadi perintah di atas aman dijalankan tanpa PostgreSQL.

Untuk menjalankan test integration, sediakan database khusus test:

```bash
docker compose up -d db
docker compose exec db createdb -U postgres finpro_test

TEST_DATABASE_URL=postgresql://postgres:password@localhost:5432/finpro_test bun test
```

Sesuaikan user dan password dengan nilai di `.env`.

> **Peringatan:** `tests/helpers/db.ts` menjalankan `DROP SCHEMA public CASCADE` sebelum setiap suite. Jangan pernah mengarahkan `TEST_DATABASE_URL` ke database yang berisi data penting. Kode menolak jalan bila nama database tidak mengandung "test".

Test integration mencakup alur pesan sampai tiket terbit, kuota habis, kedaluwarsa lewat sweeper, batas 4 tiket per pembeli, serta beberapa skenario transaksi bersaing seperti dua pembeli yang memperebutkan kursi terakhir dan pembayaran paralel.

## Daftar Endpoint

| Method | Path                             | Auth               | Keterangan                                                |
| ------ | -------------------------------- | ------------------ | --------------------------------------------------------- |
| `POST` | `/api/auth/login`                | —                  | Login dengan email dan role, mengembalikan token          |
| `GET`  | `/api/events`                    | —                  | Daftar event                                              |
| `GET`  | `/api/events/:eventId`           | —                  | Detail event dan sisa kuota per tipe                      |
| `POST` | `/api/events/:eventId/orders`    | Bearer             | Membuat pesanan (1–4 tiket)                               |
| `POST` | `/api/organizer/events`          | Bearer (organizer) | Membuat event beserta dua tipe tiket                      |
| `GET`  | `/api/organizer/events/:eventId` | Bearer (organizer) | Detail event versi penyelenggara, termasuk jumlah terjual |
| `GET`  | `/api/orders`                    | Bearer (buyer)     | Riwayat pesanan beserta tiket                             |
| `GET`  | `/api/orders/:orderId`           | Bearer (buyer)     | Detail satu pesanan                                       |
| `POST` | `/api/orders/:orderId/pay`       | Bearer (buyer)     | Simulasi pembayaran, menerbitkan tiket                    |
| `POST` | `/api/orders/:orderId/cancel`    | Bearer (buyer)     | Membatalkan pesanan sebelum dibayar                       |

## Format Respons

Semua respons sukses memakai envelope berikut:

```json
{
    "success": true,
    "message": "Order retrieved",
    "data": {}
}
```

Semua error memakai envelope berikut:

```json
{
    "error": {
        "code": "QUOTA_EXCEEDED",
        "message": "Not enough remaining quota for REGULER ticket"
    }
}
```

Daftar kode error:

| HTTP | `error.code`            | Kapan muncul                                                              |
| ---- | ----------------------- | ------------------------------------------------------------------------- |
| 400  | `VALIDATION_ERROR`      | Body request tidak lolos skema Zod                                        |
| 401  | `UNAUTHORIZED`          | Token tidak ada, tidak valid, atau role tidak sesuai                      |
| 404  | `USER_NOT_FOUND`        | Email dan role tidak cocok dengan user mana pun saat login                |
| 404  | `EVENT_NOT_FOUND`       | Event tidak ada, bukan milik organizer tersebut, atau daftar event kosong |
| 404  | `TICKET_TYPE_NOT_FOUND` | Tipe tiket yang diminta tidak dimiliki event tersebut                     |
| 404  | `ORDER_NOT_FOUND`       | Pesanan tidak ada atau bukan milik buyer yang login                       |
| 409  | `QUOTA_EXCEEDED`        | Sisa kuota tipe tiket tidak cukup                                         |
| 409  | `BUYER_LIMIT_EXCEEDED`  | Total tiket buyer di event ini akan melewati 4                            |
| 410  | `ORDER_NOT_PENDING`     | Pesanan sudah dibayar, dibatalkan, atau kedaluwarsa                       |
| 500  | `INTERNAL_ERROR`        | Kesalahan tak terduga di server                                           |

## Environment

| Variabel                    | Default                            | Keterangan                                     |
| --------------------------- | ---------------------------------- | ---------------------------------------------- |
| `PORT`                      | `8500`                             | Port HTTP                                      |
| `POSTGRES_HOST`             | `localhost`                        | Host database                                  |
| `POSTGRES_PORT`             | `5432`                             | Port database                                  |
| `POSTGRES_USER`             | `postgres`                         | User database                                  |
| `POSTGRES_PASSWORD`         | —                                  | Password database                              |
| `POSTGRES_DB`               | `database_name`                    | Nama database                                  |
| `POSTGRES_SSL`              | `false`                            | Set `true` bila database mewajibkan SSL        |
| `DATABASE_URL`              | disusun dari variabel `POSTGRES_*` | Menimpa seluruh konfigurasi di atas bila diset |
| `JWT_SECRET`                | `SECRET`                           | **Wajib diisi di luar lingkungan lokal**       |
| `JWT_ALG`                   | `HS256`                            | Salah satu dari `HS256`, `HS384`, `HS512`      |
| `ORDER_SWEEPER_ENABLED`     | `true`                             | Menyalakan sweeper kedaluwarsa                 |
| `ORDER_SWEEPER_INTERVAL_MS` | `60000`                            | Jeda antar putaran sweeper                     |
| `ORDER_SWEEPER_BATCH_SIZE`  | `100`                              | Jumlah pesanan maksimal per putaran            |

## CI/CD

`.github/workflows/ci-cd.yml` menjalankan dua job:

1. **`test`** — menyalakan service PostgreSQL, lalu `bun ci` dan `bun test`.
2. **`build-and-push`** — setelah `test` lulus, menjalankan `biome ci` dan `tsc --noEmit`. Saat event-nya `push` ke `main`, image di-build dan di-push ke GHCR dengan tag `sha-<commit>`.

Pull request hanya menjalankan pemeriksaan; image tidak di-build maupun di-push.

## Keputusan Desain

Alasan di balik skema data, strategi menjaga kuota, urutan locking, dan penanganan kedaluwarsa ada di [`DECISIONS.md`](./DECISIONS.md).
