/* Testler veritabanına DOKUNMAZ ama ai/index.ts'in bağımlılık ağacı db.ts'i içeri alır ve
   db.ts, DATABASE_URL yoksa import anında hata fırlatır. Havuz (pg.Pool) tembeldir — sorgu
   çalıştırılmadıkça bağlantı açmaz — bu yüzden gerçek bir veritabanı gerekmez, yalnız
   değişkenin var olması yeter. Yerelde .env zaten doluysa ona dokunmayız. */
process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";
