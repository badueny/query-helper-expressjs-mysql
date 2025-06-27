
# Query Helper Expressjs Mysql

## 🧱 safeQueryBuilder

**safeQueryBuilder** adalah helper Node.js modular untuk membangun query SQL secara **dinamis dan aman** di aplikasi Express + MySQL. Dirancang untuk mempermudah penggunaan `INSERT`, `SELECT`, `JOIN`, `GROUP BY`, `HAVING`, `UPDATE`, `COUNT`, `DELETE`, `PAGINASI`, dan `DataTables Server side` dengan **whitelist column/table** dan **prepared statements** untuk mencegah **SQL Injection**.

---

## ✨ Fitur Utama

### ✅ Dynamic SELECT Query
- Bangun `SELECT` dinamis dengan:
  - Pemilihan kolom tertentu (`columns`)
  - Filter kondisi WHERE (`filters`)
  - Dukungan LIMIT & OFFSET (pagination)

### ✅ Dukungan JOIN Multi-Tabel
- Menyusun banyak JOIN:
  - `LEFT`, `INNER`, `RIGHT`, `FULL` (default: `LEFT`)
  - Otomatis memvalidasi tabel join via whitelist
  - ON disusun manual untuk fleksibilitas

### ✅ Filtering Aman & Fleksibel
- Dukungan operator:
  - `=`, `LIKE`, `OR LIKE`, `>=`, `<=`, `>`, `<`
  - `IN` dengan array
  - `BETWEEN` dengan range [min, max]
- Seluruh kolom difilter melalui `allowedColumns`

### ✅ GROUP BY & HAVING
- Gunakan `groupBy` untuk mengelompokkan hasil
- Filter hasil agregat dengan `having`:
  - Operator: `=`, `>`, `<`, `>=`, `<=`, `BETWEEN`

### ✅ Optimized COUNT Query
- Jika **tanpa GROUP BY**: gunakan `SELECT COUNT(1)` langsung (lebih cepat)
- Jika **dengan GROUP BY/HAVING**: bungkus subquery agar akurat

### ✅ Datatables Server Side
- Mendukung LIKE, IN, BETWEEN, ORDER, LIMIT
- hasilnya array
  - `data`: hasil data sesuai limit, order, filter
  - `recordsTotal`: total data sebelum filter
  - `recordsFiltered`: total data setelah filter

### ✅ UPDATE & DELETE Aman
- `updateQuery`: hanya kolom terdaftar yang boleh diubah
- `deleteQuery`: wajib ada kondisi WHERE (anti truncate)

## ➕ Fitur INSERT

### 🔹 insertOneQuery
Menyusun query `INSERT` 1 baris data dengan dukungan:

- Validasi kolom (`allowedColumns`)
- Nilai aman dengan `?`
- ✅ **Opsional:** `ON DUPLICATE KEY UPDATE`

### 🔹 insertManyQuery
Menyusun query `INSERT` banyak baris data dengan dukungan:

- Validasi kolom (`allowedColumns`)
- Nilai aman dengan `?`
- ✅ **Opsional:** `ON DUPLICATE KEY UPDATE`
---

## 🛡️ Perlindungan SQL Injection

- Semua **tabel & kolom wajib di-whitelist** (`allowedTables`, `allowedColumns`)
- Nilai parameter selalu menggunakan **prepared statement (?)**
- Tidak menerima input kolom/tabel langsung dari user

---

## 📦 Struktur
```
safeQueryBuilder/
├─ index.js           # File utama helper
├─ package.json       # Metadata module
samples/
├─ orders_route.txt   # Contoh route Express lengkap (INSERT/SELECT/UPDATE/DELETE/COUNT)
├─ app.txt            # Contoh app.js
├─ db_config.txt      # Koneksi MySQL
README.txt            # Panduan singkat
```

---

## 🚀 Contoh Penggunaan
Lihat folder `samples/` untuk implementasi nyata dalam Express.js.

### Penggunaan 
1. buat folder helpers lalu copy paste folder safeQueryBuilder
2. definisikan `safeQueryBuilder` dibaris atas controller setelah  `const db = require('../config/db');`
    ```js
    const { listDataQuery, listDatatableQuery, updateQuery, deleteQuery, insertOneQuery, insertManyQuery, countQuery } = require('../helpers/safeQueryBuilder');
    ```

### listDataQuery
Untuk get data dengan filter join dan paginasi:
```js
const dateFrom = '2025-01-01'; // red.body.dateFrom
const dateTo = '2025-01-31'; // red.body.dateTo
const { dataQuery, dataValues } = listDataQuery({
  table: 'orders',
  allowedTables: ['orders', 'customers'],
  allowedColumns: ['orders.id', 'customers.name AS customer_name'],
  columns: ['orders.id', 'customers.name AS customer_name'],
  joins: [
    { table: 'customers', on: 'orders.customer_id = customers.id' }
  ],
  filters: {
    'orders.created_at': { value:[dateFrom,dateTo], operator:'BETWEEN' },
    'orders.total': { value: 500000, operator: '>=' },
    'orders.status':{ value: ['paid', 'pending'], operator: 'IN' }
  },
  limit: 10,
  offset: 0
});
```
Hasil SQL:
```sql
SELECT orders.id, orders.total, orders.status, orders.created_at
FROM orders
WHERE 1=1
  AND orders.created_at BETWEEN '2025-01-01' AND '2025-01-31'
  AND orders.total >= 500000
  AND orders.status IN ('paid', 'pending')
LIMIT 10 OFFSET 0
```

### 🔹 insertOneQuery
Untuk menyisipkan 1 baris data:

```js
const { query, values } = insertOneQuery({
  table: 'orders',
  allowedTables: ['orders'],
  allowedColumns: ['customer_id', 'total', 'status'],
  data: {
    customer_id: 1,
    total: 200000,
    status: 'pending'
  },
  onDuplicate: ['total', 'status']
});
```

Hasil SQL:
```sql
INSERT INTO orders (customer_id, total, status)
VALUES (?, ?, ?)
ON DUPLICATE KEY UPDATE total = VALUES(total), status = VALUES(status)
```

---

### 🔹 insertManyQuery
Untuk menyisipkan banyak baris sekaligus:

```js
const { query, values } = insertManyQuery({
  table: 'orders',
  allowedTables: ['orders'],
  allowedColumns: ['customer_id', 'total', 'status'],
  rows: [
    { customer_id: 1, total: 100000, status: 'pending' },
    { customer_id: 2, total: 150000, status: 'pending' }
  ]
});
```

Hasil SQL:
```sql
INSERT INTO orders (customer_id, total, status)
VALUES (?, ?, ?), (?, ?, ?)
```

> 🔒 Semua fungsi insert memfilter kolom hanya yang diizinkan (whitelist).
---

## 👨‍💻 Author
Dibuat oleh **Awenk** – Untuk komunitas developer 🇮🇩

Lisensi: [MIT](./LICENSE)