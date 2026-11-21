# Keputusan Desain

Dokumen ini menjelaskan alasan di balik keputusan teknis yang tidak terlihat langsung dari kode. Fokusnya pada hal-hal yang menentukan kebenaran data, terutama kuota tiket.

## 1. Ringkasan Stack

Sistem dibangun dengan Bun sebagai runtime, Hono sebagai HTTP framework, Kysely sebagai query builder, dan PostgreSQL sebagai database. Autentikasi memakai JWT melalui `hono/jwt`.

Kombinasi ini dipilih karena inti persoalan ada di database, bukan di framework. Jaminan "kuota tidak pernah terjual lebih" dan "satu pesanan tidak menerbitkan tiket dua kali" bergantung pada transaksi, row lock, dan constraint PostgreSQL. Framework hanya perlu meneruskan permintaan sampai ke transaksi itu. Kysely dipakai karena menghasilkan SQL eksplisit tanpa lapisan ORM yang menyembunyikan perilaku locking, sehingga `SELECT ... FOR UPDATE` dan `UPDATE ... WHERE status = 'pending'` bisa ditulis apa adanya.

## 2. Skema Data

Tujuh tabel: `users`, `events`, `ticket_types`, `orders`, `order_items`, `buyer_event_quota`, dan `tickets`. Keputusan yang tidak trivial:

### `ticket_types.reserved` sebagai counter

Sisa kuota dihitung dari `quota - reserved`, bukan dari agregasi `order_items` setiap kali dibaca. Alternatifnya, sisa selalu dihitung ulang dari pesanan aktif.

Counter dipilih karena dua alasan. Pertama, pengecekan kuota terjadi di dalam transaksi yang sudah memegang row lock pada `ticket_types`; menghitung ulang dari `order_items` akan menambah biaya baca dan memperpanjang durasi lock. Kedua, counter memberi titik serialisasi yang jelas: satu baris yang harus dikunci.

Risikonya, counter bisa melenceng bila ada jalur kode yang mengubah pesanan tanpa menyentuh `reserved`. Mitigasinya berlapis: seluruh perubahan kuota terpusat di dua fungsi (`insertOrderedTickets` untuk menambah, `releaseOrderQuota` untuk mengurangi), dan database punya `CHECK (reserved >= 0 AND reserved <= quota)` sehingga counter yang tidak masuk akal langsung ditolak.

### `buyer_event_quota` sebagai tabel terpisah

Batas 4 tiket dihitung per pasangan (event, pembeli), dan aturan ini butuh baris yang bisa dikunci. Tanpa tabel ini, pengecekan harus menjumlahkan `order_items` dari semua pesanan pembeli tersebut, dan dua request paralel bisa sama-sama lolos karena tidak ada baris yang diperebutkan.

Dengan `PRIMARY KEY (event_id, user_id)`, setiap pasangan punya tepat satu baris. Baris itulah yang dikunci sebelum batas dicek, sehingga request dari pembeli yang sama berjalan berurutan. `CHECK (ticket_count BETWEEN 0 AND 4)` menjadi jaring pengaman terakhir.

### `order_items` terpisah dari `orders`

Satu pesanan bisa berisi beberapa tipe tiket dalam jumlah berbeda, sehingga relasinya satu-ke-banyak. `order_items.unit_price` menyimpan harga saat pembelian dan tidak pernah diambil ulang dari `ticket_types.price`. Dengan begitu, perubahan harga tiket di kemudian hari tidak mengubah riwayat transaksi.

Batasan total 1–4 tiket divalidasi di aplikasi, bukan lewat `CHECK` kolom, karena `CHECK` bekerja per baris dan tidak bisa menjumlahkan baris lain dalam satu pesanan.

### `tickets.order_item_id`, bukan `order_id`

Tiket diterbitkan per item pesanan, karena tiap tipe tiket bisa berbeda harga dan jumlah. Menempelkan tiket langsung ke `orders` akan menghilangkan informasi tipe tiketnya. Kombinasi `UNIQUE (order_item_id, seq)` memberi jaminan tambahan bahwa nomor urut tiket tidak pernah dobel untuk satu item.

### `order_items.event_id` sengaja didenormalisasi

Kolom ini sebenarnya bisa diturunkan lewat `orders.event_id`, tapi disimpan langsung agar query bisa memfilter per event tanpa join. Konsistensinya tidak dijaga manual, melainkan oleh foreign key komposit `FOREIGN KEY (ticket_type_id, event_id) REFERENCES ticket_types(id, event_id)`. Dengan begitu, item pesanan mustahil merujuk tipe tiket milik event lain.

## 3. Menjaga Kuota Tidak Terjual Lebih

Alur pembuatan pesanan berjalan dalam satu transaksi:

```text
SELECT ... FROM ticket_types WHERE id = ? FOR UPDATE
  -> hitung sisa = quota - reserved
  -> tolak bila sisa < jumlah yang diminta (409 QUOTA_EXCEEDED)
  -> UPDATE ticket_types SET reserved = reserved + jumlah
  -> INSERT orders, order_items
  -> upsert buyer_event_quota
COMMIT
```

`FOR UPDATE` memberi row lock eksklusif pada baris tipe tiket. Transaksi kedua yang menyentuh baris yang sama akan menunggu sampai transaksi pertama commit, lalu membaca nilai `reserved` yang sudah terbaru. Karena pengecekan sisa dilakukan setelah lock didapat, tidak ada dua transaksi yang bisa sama-sama melihat sisa yang sama lalu sama-sama menambah. Ini yang membuat kuota tidak bisa terjual lebih.

`CHECK (reserved >= 0 AND reserved <= quota)` adalah lapis kedua. Kalau logika aplikasi keliru, update akan gagal di database alih-alih diam-diam menciptakan oversell.

Perilaku ini dikunci oleh test `only one of two racing buyers gets the last seat`: dua pembeli mengirim pesanan paralel untuk satu kursi terakhir, dan hasilnya selalu satu `201` dan satu `409 QUOTA_EXCEEDED`, dengan `reserved` berakhir di angka 1.

## 4. Menjaga Batas 4 Tiket per Pembeli

Urutan di dalam transaksi pembuatan pesanan:

```text
INSERT INTO buyer_event_quota ... ON CONFLICT DO NOTHING
  -> SELECT ... FROM buyer_event_quota FOR UPDATE
  -> tolak bila ticket_count + jumlah > 4 (409 BUYER_LIMIT_EXCEEDED)
  -> lanjut ke pengecekan dan reservasi ticket_types
  -> upsert buyer_event_quota SET ticket_count = ticket_count + jumlah
```

Langkah `INSERT ... ON CONFLICT DO NOTHING` di awal penting. Tanpa itu, dua request pertama dari pembeli yang belum punya baris tidak akan menemukan apa pun untuk dikunci, sehingga keduanya lolos pengecekan. Dengan memastikan barisnya ada lebih dulu, `FOR UPDATE` berikutnya selalu punya baris nyata untuk diserialisasi.

Kunci pada `buyer_event_quota` diambil **sebelum** `ticket_types`. Urutan ini bukan kebetulan; alasannya dijelaskan di bagian berikutnya.

Test `same buyer cannot exceed the limit via parallel orders` mengirim dua pesanan masing-masing 3 tiket secara paralel. Hasilnya selalu satu `201` dan satu `409 BUYER_LIMIT_EXCEEDED`, dengan `ticket_count` berakhir 3.

## 5. Urutan Locking dan Pencegahan Deadlock

Ini bagian yang paling mudah salah, dan memang sempat salah.

### Aturan: kunci `buyer_event_quota` dulu, baru `ticket_types`

Transaksi yang mengunci dua tabel dalam urutan berbeda bisa saling menunggu. Bila transaksi A memegang lock kuota lalu menunggu lock tipe tiket, sementara transaksi B memegang lock tipe tiket lalu menunggu lock kuota, keduanya buntu dan PostgreSQL akan membatalkan salah satunya dengan `40P01 deadlock detected`. Error itu bukan `AppError`, sehingga `app.onError` memetakannya menjadi `500 INTERNAL_ERROR` — respons yang membingungkan bagi klien yang seharusnya cukup menerima `409`.

Karena itu urutannya diseragamkan: `buyer_event_quota` selalu lebih dulu, `ticket_types` menyusul.

### `releaseOrderQuota` sempat memakai urutan terbalik

Fungsi pelepasan kuota (dipakai pembatalan, sweeper kedaluwarsa, dan lazy expiry saat pembayaran) semula meng-update `ticket_types` lebih dulu, baru `buyer_event_quota`. Itu kebalikan dari jalur pembuatan pesanan, sehingga pembatalan dan pembuatan yang berjalan bersamaan untuk pembeli dan event yang sama bisa menghasilkan deadlock.

Fungsi itu sudah dibalik: sekarang `buyer_event_quota` di-update lebih dulu, lalu `ticket_types`. Hasil akhirnya identik secara aritmetika — jumlah yang dikurangi sama — sehingga tidak ada perubahan perilaku bisnis, hanya urutan akuisisi lock.

### `ORDER BY` sebelum `FOR UPDATE` multi-baris

Ketika satu query mengunci beberapa baris sekaligus, urutan baris yang dikunci harus deterministik. Tanpa `ORDER BY`, PostgreSQL mengunci sesuai urutan hasil scan, sehingga dua transaksi yang meminta kombinasi tipe tiket sama bisa memperoleh urutan lock berbeda.

Karena itu:

- `insertOrderedTickets` memakai `.orderBy("id")` sebelum `.forUpdate()`.
- `releaseOrderQuota` memakai `.orderBy("ticket_type_id")` pada query `order_items`.

Kedua query mengunci baris `ticket_types` dalam urutan `id` yang sama, sehingga tidak ada dua transaksi yang bisa saling menyalip.

### Catatan pemeliharaan

Aturan ini tidak dijaga oleh tipe maupun constraint. Setiap kode baru yang menyentuh kuota wajib mengikuti urutan `buyer_event_quota` lalu `ticket_types`, dengan `ORDER BY` deterministik sebelum `FOR UPDATE` multi-baris.

## 6. Kedaluwarsa 15 Menit

Pesanan menahan kuota selama 15 menit (`ORDER_TTL_MS`). Pelepasan kuota memakai dua lapis yang saling melengkapi.

### Lapis pertama: lazy expiry

Saat `pay` atau `cancel` dipanggil, sistem memeriksa `expires_at` lebih dulu. Bila sudah lewat, pesanan di-expire saat itu juga dan kuotanya dilepas, lalu request dibalas `410 ORDER_NOT_PENDING`.

Lapis ini penting karena membuat kebenaran tidak bergantung pada jadwal sweeper. Walau sweeper sedang mati atau belum sempat berjalan, pesanan yang sudah lewat waktu tetap tidak bisa dibayar.

### Lapis kedua: sweeper berkala

Sweeper membersihkan pesanan kedaluwarsa yang tidak pernah disentuh pengguna, supaya kuotanya kembali tanpa menunggu ada request masuk.

Empat keputusan di dalamnya:

**`FOR UPDATE SKIP LOCKED`.** Sweeper mengunci baris yang akan diproses dan melewati baris yang sudah dikunci proses lain. Bila ada beberapa instance aplikasi berjalan, atau satu putaran sweeper bertabrakan dengan request pembayaran, tidak ada yang saling menunggu.

**Batch dengan `LIMIT`.** `ORDER_SWEEPER_BATCH_SIZE` membatasi jumlah pesanan per putaran. Tujuannya menjaga agar satu transaksi tidak terlalu panjang dan tidak menahan lock terlalu lama saat ada tumpukan pesanan kedaluwarsa.

**`setTimeout` rekursif, bukan `setInterval`.** Jadwal berikutnya baru dipasang di blok `finally`, setelah putaran saat ini selesai. Dengan `setInterval`, putaran baru tetap dijadwalkan tiap interval walau putaran sebelumnya belum selesai, sehingga dua sweep bisa berjalan bersamaan dan berebut baris yang sama. Konsekuensinya, frekuensi efektifnya adalah interval ditambah durasi putaran, bukan tepat interval. Itu trade-off yang disengaja.

**Index parsial.** `orders_sweeper_idx ON orders (expires_at) WHERE status = 'pending'` hanya mengindeks baris yang relevan bagi sweeper. Ukurannya tetap kecil walau tabel `orders` sudah berisi banyak pesanan lunas atau batal.

Sweeper dihentikan lewat fungsi yang dikembalikan `startOrderExpirySweeper`. Fungsi itu dipanggil pada `SIGINT` dan `SIGTERM` agar timer tidak menggantung saat proses dimatikan.

## 7. Mencegah Tiket Terbit Dobel

Pembayaran mengubah status dengan syarat status saat itu, bukan dengan membaca lebih dulu lalu menulis:

```text
UPDATE orders SET status = 'paid', paid_at = ?
 WHERE id = ? AND status = 'pending'
```

Bila dua request pembayaran datang bersamaan, hanya satu yang berhasil mengubah baris. Yang kalah tidak menemukan baris `pending` lagi dan dibalas `410 ORDER_NOT_PENDING`. Penerbitan tiket dilakukan di dalam transaksi yang sama dengan perubahan status, sehingga tidak mungkin ada status `paid` tanpa tiket atau tiket tanpa status `paid`.

`UNIQUE (order_item_id, seq)` menjadi pengaman terakhir di level database.

Diuji oleh `parallel pays issue tickets exactly once` (dua pembayaran paralel menghasilkan satu `200` dan satu `410`, dengan tepat satu tiket) dan `rejects a second payment`.

## 8. Auth

Auth memakai JWT HS256 tanpa refresh token. Login hanya memerlukan email dan role, tanpa password. Keputusan ini diambil sadar karena sesuai ketentuan tugas, auth tidak dinilai dan tujuannya hanya mengidentifikasi pembeli.

**Risikonya nyata dan perlu dinyatakan terbuka:** siapa pun yang mengetahui email seorang user dapat memperoleh token atas nama user tersebut, cukup dengan menyebut role yang sesuai. Tidak ada verifikasi kepemilikan akun sama sekali. Selain itu, token berumur 30 menit dan tidak bisa dicabut sebelum kedaluwarsa, dan tidak ada rate limit pada endpoint login.

Karena itu sistem ini hanya pantas dijalankan lokal atau di lingkungan demo tertutup, bukan diekspos ke internet. Bila hendak dilanjutkan ke produksi, minimal perlu password atau OAuth, refresh token dengan mekanisme pencabutan, dan rate limit pada login. Struktur kode sudah mendukungnya: yang berubah hanya alur `login` dan isi payload token.

## 9. Keputusan yang Sengaja Tidak Diambil

**Webhook pembayaran idempotent.** Ini nilai tambah opsional, bukan kebutuhan inti. Mengerjakannya menambah permukaan yang harus benar — pengiriman ganda, pesan terlambat, pesan yang tiba setelah pesanan kedaluwarsa — sementara fokus diarahkan ke kebenaran kuota inti. Konsekuensinya, simulasi pembayaran dilakukan lewat endpoint `pay` yang dipanggil langsung.

**`GET /api/events` membalas `EVENT_NOT_FOUND` saat belum ada event.** Secara REST, daftar kosong lebih lazim dibalas `200` dengan `[]`. Perilaku sekarang adalah konsekuensi dari handler yang melempar `AppError` ketika hasilnya kosong. Tidak diubah agar cakupan pekerjaan tetap pada kebenaran kuota, tetapi ini layak diperbaiki bila API dipakai klien sungguhan.

**`INVALID_QUANTITY` dideklarasikan tetapi tidak pernah dilempar.** Kode error ini ada di `ERROR_STATUS`, namun validasi jumlah tiket sudah ditangani Zod (`quantity >= 1`) dan pengecekan total 1–4 di service. Kode ini disisakan untuk pemakaian yang mungkin menyusul, bukan bagian dari alur aktif.

**Pool koneksi `pg` memakai default 10.** Cukup untuk demo lokal dan test. Belum disetel untuk beban produksi, dan menaikkannya harus dibarengi penyesuaian `max_connections` PostgreSQL agar tidak memunculkan error "too many clients".

## 10. Catatan Operasional

Perubahan skema dilakukan lewat `src/db/schema.sql`, bukan lewat file migrasi bertahap. Berkas itu dipasang ke `/docker-entrypoint-initdb.d` dan hanya dijalankan saat direktori data Postgres masih kosong, sehingga perubahan skema pada database yang sudah berjalan menuntut pembangunan ulang volume data.

Setelah skema berubah, `src/db/type.d.ts` harus dibuat ulang dengan:

```bash
bun run db:codegen
```

Berkas itu hasil generate `kysely-codegen` dan tidak boleh diedit manual; setiap perubahan manual akan hilang pada generate berikutnya.

Seed berada di `src/db/seeds` dan dijalankan lewat `bun run db:seed` atau, di dalam container, melalui profile `seed` pada Docker Compose. Seed tidak berjalan otomatis saat `docker compose up`.
