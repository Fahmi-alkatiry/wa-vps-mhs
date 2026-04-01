import mysql from "mysql2/promise";
import axios from "axios";
import cron from "node-cron";
import "dotenv/config";

// --- KONFIGURASI ---
const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "nama_db_anda",
};

const pool = mysql.createPool(dbConfig);

const WA_URL = process.env.WA_GATEWAY_URL;
const waUser = process.env.WA_BASIC_USER || "user1";
const waPass = process.env.WA_BASIC_PASS || "pass1";
const WA_DEVICE_ID = process.env.WA_DEVICE_ID || "myperfume";
const MY_NUMBER = "089668125652";
const pesan = 3;

const PROMO_MESSAGE = `*✨Cuma 1 Menit dari UNIRA! 🎓✨*

*✨ Awali bulan April dengan wangi terbaik dari My Perfume ✨*

Nikmati *DISKON 20%* untuk setiap pembelian minimal Rp 50.000 🎉
Saatnya upgrade aroma favoritmu jadi lebih fresh & premium!

Biarkan harummu menemani setiap aktivitas di bulan ini 🌿💫

📅 *Periode Promo:* 1– 30 April 

*Syarat & Ketentuan:*
* ✨ Follow & mention IG: @myperfumee__
* 🎵 Follow TikTok: @myperfumee__

Yuk langsung datang ke store kami! 
📍 *Lokasi:* Jl. Panglegur (Selatan pertigaan lampu merah Terminal Ronggosukowati, timur jalan).`;

// --- FUNGSI PEMBANTU ---

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const formatPhone = (phone) => {
  let p = String(phone).trim().replace(/\D/g, "");
  if (p.startsWith("0")) p = "62" + p.slice(1);
  if (p.startsWith("8")) p = "62" + p;
  if (!p.endsWith("@s.whatsapp.net")) p = p + "@s.whatsapp.net";
  return p;
};

const sendWAMessage = async (phone, message) => {
  const formattedPhone = formatPhone(phone);
  if (!message.trim()) throw new Error("Pesan kosong");

  try {
    const payload = { phone: formattedPhone, message };
    const response = await axios.post(`${WA_URL}/send/message`, payload, {
      headers: { "X-Device-Id": WA_DEVICE_ID },
      auth: { username: waUser, password: waPass },
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`WA Gateway error: ${response.status}`);
    }

    console.log(`[WA] Terkirim ke ${formattedPhone}`);
    return response.data;
  } catch (error) {
    console.error(
      `[WA Error] Gagal ke ${formattedPhone}:`,
      error.response?.data || error.message,
    );
    throw error;
  }
};

async function safeSend(phone, msg, retry = 2) {
  try {
    await sendWAMessage(phone, msg);
    return true;
  } catch (err) {
    const errorMsg = err.response?.data?.message || err.message;
    if (
      errorMsg.includes("not on whatsapp") ||
      errorMsg.includes("INVALID_JID")
    ) {
      console.log(`🚫 Lewati ${phone} (Tidak terdaftar)`);
      return false;
    }

    if (retry > 0) {
      const retryDelay = Math.floor(Math.random() * 5000) + 4000;
      await wait(retryDelay);
      return safeSend(phone, msg, retry - 1);
    }
    return false;
  }
}

// --- LOGIKA UTAMA ---

async function runBroadcast(limit) {
  console.log(
    `\n[${new Date().toLocaleString()}] Memulai batch ${limit} pesan...`,
  );
  let conn;
  try {
    conn = await pool.getConnection();

    // Ambil data status 0
    // SELECT id, hp FROM unira WHERE status = 0 AND nik LIKE "352801%";
    const [rows] = await conn.execute(
      'SELECT id, hp FROM unira WHERE status = 0 AND nik LIKE "352801%" LIMIT ?',
      [limit],
    );

    if (rows.length === 0) {
      console.log("Tidak ada antrean (Status 0).");
      return;
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      // Kirim pesan
      const success = await safeSend(row.hp, PROMO_MESSAGE);
      const finalStatus = success ? 1 : 2;

      // Update database
      await conn.execute(
        "UPDATE unira SET status = ?, updatedAt = NOW() WHERE id = ?",
        [finalStatus, row.id],
      );
      console.log(`ID ${row.id} -> Status ${finalStatus}`);

      // JEDA 5 MENIT (300.000 ms) - Jangan menunggu jika ini pesan terakhir di batch
      if (i < rows.length - 1) {
        console.log(`Menunggu 5 menit sebelum pesan berikutnya...`);
        await wait(300000);
      }
    }
  } catch (error) {
    console.error("Broadcast Error:", error);
  } finally {
    if (conn) conn.release();
  }
}

async function sendProgressReport() {
  console.log("\n[LAPORAN] Mengirim progres harian...");
  let conn;
  try {
    conn = await pool.getConnection();
    const [rows] = await conn.execute(
      'SELECT status, COUNT(*) as total FROM unira WHERE nik LIKE "352801%" GROUP BY status;',
    );
    // SELECT status, COUNT(*) as total FROM unira WHERE nik LIKE "352801%" GROUP BY status;

    let report = { 0: 0, 1: 0, 2: 0 };
    rows.forEach((r) => (report[r.status] = r.total));

    const msg =
      `📊 *Laporan Progres My Perfume*\n\n` +
      `✅ Berhasil: ${report[1]}\n` +
      `❌ Gagal: ${report[2]}\n` +
      `⏳ Sisa Antrean: ${report[0]}\n\n` +
      `Waktu: ${new Date().toLocaleString("id-ID")}`;

    await safeSend(MY_NUMBER, msg);
    console.log("Laporan terkirim ke admin.");
  } catch (error) {
    console.error("Report Error:", error);
  } finally {
    if (conn) conn.release();
  }
}

// --- JADWAL (CRON) ---

// Jam 9 Pagi - Kirim 3 pesan (total waktu kirim: ~10 menit karena jeda)
cron.schedule('0 9 * * *', () => runBroadcast(pesan), { timezone: "Asia/Jakarta" });

// Jam 12 Siang - Kirim 3 pesan
cron.schedule('0 12 * * *', () => runBroadcast(pesan), { timezone: "Asia/Jakarta" });

// Jam 4 Sore - Kirim 3 pesan
cron.schedule('0 16 * * *', () => runBroadcast(pesan), { timezone: "Asia/Jakarta" });

// Jam 5 Sore - Laporan ke Admin
cron.schedule("0 17 * * *", () => sendProgressReport(), {
  timezone: "Asia/Jakarta",
});

console.log("🚀 My Perfume Service Aktif (Jeda 5 Menit per pesan)...");
// sendProgressReport()

// safeSend(MY_NUMBER, PROMO_MESSAGE);
