# AIESP (AI English Speaking Practice) — Tổng quan & Báo cáo dự án

Cập nhật: 2025-11-14

Mục tiêu tài liệu: Tóm tắt từ tổng quan đến chi tiết để bạn đọc/hiểu dự án, dùng làm tài liệu thuyết trình/báo cáo và hỗ trợ vận hành, phát triển tiếp theo.

---

## 1) Tổng Quan Hệ Thống

AIESP là nền tảng luyện nói tiếng Anh, kết hợp:
- Ứng dụng web (React + Tailwind + Vite) cho học viên.
- Kiến trúc microservices (Node.js/Express) và Postgres làm CSDL.
- Dịch vụ AI (ASR + LLM scoring) cho chấm điểm phát âm và hội thoại.
- Cổng Gateway reverse-proxy thống nhất các API dịch vụ và phục vụ frontend trong môi trường production.
- Dòng thanh toán demo với gói AI-only và gói Mentor (quy tắc nâng cấp pro‑rata, hủy cuối chu kỳ, ghi nhận payments demo).

Môi trường triển khai sử dụng Docker Compose để chạy toàn bộ các dịch vụ.

---

## 2) Kiến Trúc & Luồng Chính

- `frontend` (React, Vite): giao diện web, đăng nhập, hồ sơ, lộ trình học, hội thoại, trang gói dịch vụ.
- `gateway` (Express + http-proxy-middleware): làm reverse proxy cho `/api/*`, cấu hình CORS tập trung, phục vụ static frontend (production).
- `services/*`:
  - `auth-service`: xác thực, phát hành JWT.
  - `learner-service`: dữ liệu người học, hồ sơ, lộ trình học, hội thoại, subscriptions/plans/payments (demo billing).
  - `ai-service`: pipeline AI và endpoint chấm điểm phát âm LLM-only.
  - `mentor-service`: khung dịch vụ mentor (điểm nối tích hợp mở rộng).
- `postgres`: CSDL chính, khởi tạo schema bằng các file SQL trong `database/init`.
- Proxy bổ sung: `gateway` còn định tuyến `/api/pronunciation` tới `pronunciation-assessment` (dịch vụ thử nghiệm tách rời; không bắt buộc cho flow chính).

Sơ đồ ASCII đơn giản:

```
[Browser] --HTTP--> [Gateway] --/api/auth------> [auth-service]
                     |         --/api/learners--> [learner-service] --(SQL)--> [Postgres]
                     |         --/api/ai--------> [ai-service]      --(LLM)--> [OpenAI Compatible API]
                     |         --/api/mentor----> [mentor-service]
                     |         --/api/pronunciation -> [pronunciation-assessment] (tuỳ chọn)
                     \--(prod static)--> [frontend]
```

---

## 3) Cấu Trúc Thư Mục Chính

- `frontend/` — Ứng dụng React (Vite)
  - `src/App.jsx` — định tuyến: `/`, `/login`, `/auth/callback`, `/profile`, `/level-test`, `/plans`, `/roadmap`, `/lesson/:lessonId/chat`, `/onboarding`
  - `src/plans/SubscriptionPage.jsx` — trang gói dịch vụ (subscribe, cancel, upgrade)
  - `src/profile/ProfilePage.jsx` — hồ sơ học viên (goals/interests, UX cải tiến)
- `gateway/` — Reverse proxy cho API và phục vụ frontend (prod)
  - `src/index.js` — khai báo proxy `/api/auth`, `/api/learners`, `/api/v1/learning-path`, `/api/mentor`, `/api/ai`, `/api/pronunciation`
- `services/`
  - `auth-service/` — JWT Auth
  - `learner-service/` — học viên, lộ trình, hội thoại, subscriptions & payments (demo)
  - `ai-service/` — chấm điểm phát âm LLM-only, chuẩn bị hạ tầng ASR/VAD/align
  - `mentor-service/` — khung tích hợp mentor
- `database/init/` — schema SQL:
  - `000_users.sql`, `001_pronunciation.sql`, `002_sessions.sql`, `003_profiles.sql|003_profiles_and_prefs.sql`
  - `004_subscriptions.sql` — bảng subscriptions (và payments được đảm bảo trong service)
  - `010_learning_path.sql`, `011_ai_roadmap.sql`, `012_ai_roadmap_guard.sql`, `013_conversation.sql`
- `docker-compose.yml` — dàn dịch vụ & mạng nội bộ

---

## 4) Frontend (React + Vite + Tailwind)

- Trang & tính năng chính:
  - `/login`, `/auth/callback`: đăng nhập, nhận JWT.
  - `/`: trang chủ người dùng sau đăng nhập (trong `AppShell`).
  - `/profile`: cập nhật mục tiêu học tập, hiển thị trạng thái “đã lưu”/“chưa lưu”, preview; textarea nền trắng; hiệu ứng nhẹ nhàng.
  - `/level-test`: trang kiểm tra trình độ (khung sẵn sàng kết nối AI service).
  - `/plans` (`SubscriptionPage.jsx`): hiển thị kế hoạch, trạng thái subscription hiện tại; thao tác subscribe, cancel cuối chu kỳ, upgrade với báo giá pro‑rata.
  - `/roadmap`, `/lesson/:lessonId/chat`: lộ trình học và bài hội thoại (tích hợp AI gợi ý câu mở, gợi ý trả lời, lưu lịch sử hội thoại).
- Dev workflow: Vite dev server hỗ trợ HMR, thuận tiện thử nhanh UI.
- Prod: bundle được build sẵn, phục vụ qua `gateway`.

---

## 5) Gateway (Reverse Proxy)

- CORS tập trung (theo env `CORS_ORIGIN`).
- Không parse body trước proxy để tránh “nuốt” request body (đã fix lỗi timeout trước đây).
- Định tuyến chính:
  - `/api/auth` → `auth-service`
  - `/api/learners` → `learner-service`
  - `/api/v1/learning-path` → `learner-service` (rewrite tới `/learning-path`)
  - `/api/mentor` → `mentor-service`
  - `/api/ai` → `ai-service` (rewrite bỏ `/api/ai`)
  - `/api/pronunciation` → `pronunciation-assessment` (dịch vụ thử nghiệm tuỳ chọn)
- Phục vụ frontend (prod): fallback `/` → `frontend` runner.

---

## 6) AI Service (Chấm điểm phát âm LLM-only)

- Endpoint chính:
  - `POST /api/ai/pronunciation/score` (qua Gateway) → `ai-service` `/pronunciation/score`
    - Form-Data: `audio` (file), `text` (chuỗi target)
    - Trả về: điểm tổng quan và thang điểm con (tuỳ cấu hình prompt LLM); nếu AI không khả dụng → trả `503/500` (không còn fallback “hard logic”).
- Hạ tầng đã sẵn (module ingest/VAD/ASR/align), có thể mở rộng dùng Whisper/WhisperX trong tương lai.
- Yêu cầu ENV: `OPENAI_API_KEY`, `OPENAI_BASE_URL` (tương thích OpenAI), `OPENAI_MODEL`/`OPENAI_MODEL_CHAT` nếu cần.

---

## 7) Learner Service (Hồ sơ, lộ trình, hội thoại, Subscriptions)

- Auth: yêu cầu header `Authorization: Bearer <JWT>` hoặc cookie tương đương (qua gateway auth).
- Subscriptions & Plans (đường dẫn đúng — lưu ý tiền tố `/subscriptions`, không phải `/billing`):
  - `GET /api/learners/subscriptions/plans` — danh sách plan khả dụng.
  - `GET /api/learners/subscriptions/me` — subscription hiện tại của người dùng.
  - `POST /api/learners/subscriptions/choose` — đăng ký plan (bắt đầu chu kỳ 30 ngày từ “hôm nay”).
  - `POST /api/learners/subscriptions/cancel` — hủy cuối chu kỳ (`cancel_at_period_end = true`).
  - `GET /api/learners/subscriptions/upgrade/quote?new_plan_id=mentor_plus` — báo giá nâng cấp (pro‑rata: tính phần chênh lệch theo ngày còn lại của chu kỳ).
  - `POST /api/learners/subscriptions/upgrade` — nâng cấp ngay: tự động gỡ trạng thái cancel, chuyển plan; nếu `amount_due_now_vnd > 0` thì ghi nhận `payments` (demo).
- Bảng & đảm bảo schema:
  - `plans`: danh mục plan (`ai_basic`, `mentor_plus`).
  - `subscriptions`: trạng thái, kỳ hạn (start/end), cờ hủy cuối kỳ, khoá ngoại `plan_id`.
  - `payments`: ghi nhận thanh toán demo (liên kết `subscription_id`).
  - Service tự “ensure” schema nếu init scripts thiếu (hữu ích khi dev).
- Các phần khác (rút gọn): hồ sơ người học, lộ trình học, hội thoại có schema trong `database/init`.

---

## 8) Database (Postgres)

- Khởi tạo bằng `database/init/*.sql` khi container Postgres tạo mới.
- Với môi trường đã chạy rồi và thêm migration mới, có thể áp dụng thủ công:

```powershell
# Lấy container id của postgres
$pg = docker compose ps -q postgres

# Copy file SQL vào container
docker cp .\database\init\004_subscriptions.sql ${pg}:/tmp/004.sql

# Áp dụng
docker compose exec -T postgres psql -U aesp -d aespdb -f /tmp/004.sql
```

- Các file schema tiêu biểu: users, pronunciation, sessions, profiles, subscriptions, learning_path, ai_roadmap, conversation.

---

## 9) Chạy Dự Án (Docker Compose)

- Yêu cầu: Docker Desktop; cổng `8080` trống.
- ENV mẫu: tham khảo `.env.example` và `.env`.
- Lệnh chạy/all-in:

```powershell
# Build & start tất cả dịch vụ
docker compose up -d --build

# Kiểm tra gateway phục vụ frontend
powershell -NoProfile -Command "(Invoke-WebRequest -Uri http://localhost:8080 -UseBasicParsing).StatusCode"

# Nếu mới thay đổi learner-service/frontend/gateway
docker compose up -d --build learner-service frontend gateway
```

- Truy cập web: `http://localhost:8080`
- Đăng nhập → điều hướng trong app (Home, Profile, Plans, Roadmap, Lesson Chat...).

---

## 10) Demo Billing Flow (Quy tắc & Thử nhanh)

- Kỳ hạn cố định 30 ngày. Nâng cấp pro‑rata: thu phần chênh lệch tính theo ngày còn lại. Nâng cấp sẽ gỡ trạng thái “hủy cuối kỳ” nếu có.
- Các bước thử trong UI (`/plans`):
  1) Chọn plan `Self-Study (AI-Only)` (200k VND) → `subscriptions/choose`.
  2) Đặt hủy cuối kỳ → `subscriptions/cancel`.
  3) Nâng cấp `Mentor-Included` (800k VND) → xem modal báo giá → Xác nhận → `subscriptions/upgrade`.
  4) Kiểm tra trạng thái đã gỡ `cancel_at_period_end` và plan hiện là `mentor_plus`.

- Tương đương qua API (đã đăng nhập; thay token):

```powershell
$headers = @{ Authorization = "Bearer <JWT>" }

# Plans
Invoke-RestMethod -Uri http://localhost:8080/api/learners/subscriptions/plans -Headers $headers

# Subscribe
Invoke-RestMethod -Method Post -Uri http://localhost:8080/api/learners/subscriptions/choose -Headers $headers -Body (@{ plan_id='ai_basic' } | ConvertTo-Json) -ContentType 'application/json'

# Cancel at period end
Invoke-RestMethod -Method Post -Uri http://localhost:8080/api/learners/subscriptions/cancel -Headers $headers

# Quote upgrade
Invoke-RestMethod -Uri "http://localhost:8080/api/learners/subscriptions/upgrade/quote?new_plan_id=mentor_plus" -Headers $headers

# Upgrade
Invoke-RestMethod -Method Post -Uri http://localhost:8080/api/learners/subscriptions/upgrade -Headers $headers -Body (@{ new_plan_id='mentor_plus' } | ConvertTo-Json) -ContentType 'application/json'
```

---

## 11) Chấm Điểm Phát Âm (AI-only Scoring)

- Yêu cầu ENV cho `ai-service`: `OPENAI_API_KEY`, `OPENAI_BASE_URL` (nếu dùng endpoint tương thích OpenAI), model mong muốn.
- Thử nhanh (PowerShell + curl):

```powershell
# Gửi file âm thanh và target text
curl.exe -s -X POST "http://localhost:8080/api/ai/pronunciation/score" ^
  -H "Accept: application/json" ^
  -F "audio=@sample.wav" ^
  -F "text=I would like a cup of coffee"
```

- Kết quả trả về: điểm/tổng hợp theo prompt LLM. Nếu AI lỗi: trả `503/500` (không fallback nội bộ).

---

## 12) Biến Môi Trường Chính (tham khảo)

- Chung:
  - `DATABASE_URL` — chuỗi kết nối Postgres.
  - `JWT_SECRET` — bí mật ký JWT.
  - `CORS_ORIGIN` — allowlist origin (gateway).
- `ai-service`/`learner-service` (gọi AI):
  - `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` hoặc `OPENAI_MODEL_CHAT`.
  - `OPENAI_CONCURRENCY` — giới hạn đồng thời khi gọi AI (learner-service).
- Gateway:
  - `GATEWAY_PORT` (mặc định 8080).

---

## 13) Troubleshooting Nhanh

- 401 khi gọi API: cần đăng nhập, hoặc JWT không hợp lệ (qua gateway). Thử đăng nhập lại từ `/login`.
- Không thấy thay đổi UI: production build được phục vụ qua gateway; cần rebuild `frontend` hoặc dùng Vite dev server khi phát triển.
- Timeout khi proxy body: gateway đã bỏ `express.json()` trước proxy (đã fix). Giữ nguyên để không “nuốt” request body.
- Migration không tự chạy: dùng lệnh psql áp dụng trực tiếp vào container Postgres (xem mục Database).

---

## 14) Hướng Phát Triển Tiếp

- Tích hợp WhisperX/diarization để canh thời gian/phoneme alignment chuẩn hơn, cộng thêm prosody (tốc độ, ngữ điệu) cho rubric chấm điểm phong phú.
- Lịch sử thanh toán/hoá đơn (demo): trang lịch sử, export CSV.
- Feature gating UI dựa trên plan (ẩn/disable tính năng mentor khi `ai_basic`).
- Bổ sung monitoring/log aggregation cho gateway và AI calls.
- Viết test E2E cho các luồng chính (login → profile → plans → upgrade → lesson chat).

---

## 15) Ghi Chú Báo Cáo/Trình Bày

- Vấn đề đã xử lý nổi bật:
  - Sửa lỗi timeout do gateway parse body trước proxy (root cause) → gỡ `express.json()` ở gateway.
  - Cải tiến UX trang Profile: trạng thái lưu, preview, animations, textarea nền trắng.
  - Xây dựng AI pronunciation scoring AI-only, fail-fast khi AI lỗi (không dùng “hard logic”).
  - Demo billing flow: 30 ngày, pro‑rata upgrade, huỷ cuối chu kỳ, override cancel khi upgrade, ghi nhận payment demo.
  - Áp dụng migration subscriptions thành công trên Postgres đang chạy.
- Điểm mạnh kiến trúc:
  - Microservices rõ ràng, gateway làm “cửa” duy nhất.
  - Dev workflow nhanh với Vite HMR; prod bundle phục vụ ổn định qua gateway.
  - Schema SQL minh bạch, có fallback ensure trong service khi dev.

---

## 16) Phụ Lục — Cấu Hình Proxy Gateway

- `GET /health` (gateway): kiểm tra tình trạng.
- Proxy mapping:
  - `/api/auth` → `auth-service`
  - `/api/learners` → `learner-service`
  - `/api/v1/learning-path` → `learner-service` (rewrite)
  - `/api/mentor` → `mentor-service`
  - `/api/ai` → `ai-service` (rewrite)
  - `/api/pronunciation` → `pronunciation-assessment` (tuỳ chọn)
- Static (prod): `/` → `frontend` runner.

---

Tài liệu này (readme2.md) phản ánh trạng thái hiện tại và đủ nội dung để bạn ôn, trình bày, và vận hành demo end‑to‑end. Nếu bạn muốn, mình có thể thêm sơ đồ kiến trúc bằng hình ảnh hoặc bổ sung checklist test nhanh theo từng luồng.
