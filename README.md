# xdoopBT – Nền tảng Demo Luyện Nói AI & Gói Thuê Bao

## 🔰 Quick Start (Khởi động nhanh)

```bash
# 1. Clone dự án
git clone https://github.com/thangvn0987/xdoopBT.git
cd xdoopBT

# 2. Tạo file .env từ mẫu
cp .env.example .env
# Mở .env và điền các key: OPENAI_API_KEY, SPEECH_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, JWT_SECRET

# 3. Khởi chạy bằng Docker Compose
docker compose up --build

# 4. Truy cập giao diện (qua gateway)
open http://localhost:8080

# 5. Đăng nhập Google OAuth và thử các endpoint /plans, /roadmap, /api/pronunciation/tts
```

Nếu không dùng Docker: chạy Postgres, cài `npm install` trong từng service rồi khởi động gateway + frontend như hướng dẫn phía dưới.

Kho mã này là một ứng dụng Node.js đa dịch vụ minh họa:

1. Lộ trình học (roadmap) do AI tạo theo từng người dùng (tạo bài học, theo dõi tiến độ).
2. Đánh giá phát âm thời gian thực và chuyển văn bản thành giọng nói (Azure Speech).
3. Phiên hội thoại hướng dẫn (AI + lượt nói của người học, chấm điểm, phát lại TTS).
4. Quản lý gói thuê bao với nâng cấp tính theo phần còn lại (proration) và hủy vào cuối chu kỳ.
5. Frontend (React + Vite + MUI) gọi API qua Gateway.

## Kiến trúc tổng quan

```mermaid
graph TD
  U[Người dùng] --> FE[Frontend (React/Vite)]
  FE --> GW[Gateway (Express)]

  GW -->|/api/auth/...| AUTH[auth-service]
  GW -->|/api/learners/...| LEARN[learner-service]
  GW -->|/api/pronunciation/...| PRON[pronunciation-assessment]

  LEARN -.->|fallback| AI[ai-service (scripts)]
  LEARN -.->|tương lai| MENT[mentor-service?]

  AUTH --> DB[(Postgres)]
  LEARN --> DB
  PRON --> DB

  PRON -->|TTS + Assessment| AZURE[Azure Speech Services]
  LEARN -->|Chat Completions| OPENAI[OpenAI-compatible API]

  classDef ext fill:#eef,stroke:#99f,stroke-width:1px;
  class AZURE,OPENAI ext;
```

## Các dịch vụ

| Service                  | Mục đích                               | Cổng (nội bộ) |
| ------------------------ | -------------------------------------- | ------------- |
| gateway                  | Reverse proxy, ranh giới CORS          | 8080          |
| auth-service             | OAuth (Google) + phát hành JWT         | 3000 (map)    |
| learner-service          | Roadmap, gói thuê bao, phiên hội thoại | 3000 (map)    |
| pronunciation-assessment | Chấm phát âm + cache TTS               | 8085          |
| ai-service               | Sinh kịch bản nội bộ (fallback)        | 3000 (nội bộ) |
| frontend                 | Giao diện React (Vite)                 | 3000          |

> Bên trong container, nhiều dịch vụ có thể dùng cùng cổng (vd 3000) vì Gateway gọi theo tên service trong mạng Docker.

## Tính năng chính

### Lộ trình học (Learning Path)

- Tạo tiêu đề bài học theo người dùng & mục tiêu bằng AI hoặc heuristic.
- Khóa tư vấn (advisory lock) trong DB tránh trùng tạo khi có race.
- Tiến độ lưu ở bảng `LearnerProgress`.

### Phiên hội thoại (Conversation Sessions)

- Bảng: `ConversationSessions`, `ConversationTurns`.
- Mỗi lượt nói của người học được chấm điểm tổng hợp (độ chính xác, độ trôi chảy, mức hoàn thiện, ngữ điệu, điểm phát âm + điều chỉnh công bằng theo mức liên quan).
- Lượt nói của AI có thể tổng hợp TTS MP3 (Azure) và được cache theo nội dung.

### Đánh giá phát âm & TTS

- `POST /assess` (multipart audio) dùng Azure SDK.
- `POST /tts` dùng Azure HTTP API với:
  - Cache đĩa + bộ nhớ (hash(text|voice)).
  - Khử trùng lặp khi đang xử lý (in‑flight de‑duplication).
  - Giới hạn đồng thời & retry/backoff.

### Gói thuê bao (Subscriptions)

- Bảng gói (`ai_basic`, `mentor_plus`).
- Nâng cấp pro‑rated: chỉ tính phần chênh lệch theo ngày còn lại.
- Giữ trạng thái hủy cuối kỳ khi nâng cấp ghi đè (override cancel-at-period-end).

### Độ bền bất đồng bộ (Async Robustness)

- `fetchWithRetry` + AbortController cho các call lênh ngoài (OpenAI, Azure, dịch vụ nội bộ).
- Giới hạn đồng thời cho OpenAI và Azure TTS.
- Express error middleware + guard ở mức process.

## Yêu cầu

- Docker & Docker Compose (khuyến nghị cho dev)
- Node.js >= 18 (nếu chạy dịch vụ local, không dùng Docker)
- Tài khoản Azure Speech (key/region)
- Thông tin Google OAuth (Client ID/Secret) nếu cần đăng nhập
- Endpoint + key OpenAI‑compatible (hoặc để trống để dùng heuristic fallback)

## Cấu hình môi trường

Xem `.env.example` để biết đầy đủ biến môi trường. Sao chép để tạo `.env` và điền secrets:

```bash
cp .env.example .env
# Sửa .env: OPENAI_API_KEY, SPEECH_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, JWT_SECRET, ...
```

Biến quan trọng:

| Biến                                         | Mô tả                                                     |
| -------------------------------------------- | --------------------------------------------------------- |
| OPENAI_BASE_URL                              | URL gốc của API OpenAI‑compatible (tự thêm /v1 nếu thiếu) |
| OPENAI_MODEL_CHAT                            | Model dùng cho chat completions                           |
| OPENAI_CONCURRENCY                           | Số request OpenAI tối đa đồng thời (learner-service)      |
| SPEECH_KEY / SPEECH_REGION                   | Thông tin Azure Speech                                    |
| TTS_CONCURRENCY                              | Số request TTS đồng thời                                  |
| AUTH_RATE_LIMIT_MAX / GENERAL_RATE_LIMIT_MAX | Cấu hình rate limit ở auth-service                        |
| ADMIN_EMAILS                                 | Danh sách email admin (phân tách bằng dấu phẩy/chấm phẩy) |

## Chạy bằng Docker Compose

```bash
docker compose up --build
```

Các URL qua Gateway:

- Auth API: `http://localhost:8080/api/auth/...`
- Learner API: `http://localhost:8080/api/learners/...`
- Learning Path v1: `http://localhost:8080/api/v1/learning-path/...`
- Pronunciation: `http://localhost:8080/api/pronunciation/...`

Luồng đăng nhập:

1. Truy cập `http://localhost:8080/` (Gateway proxy tới Frontend).
2. Bấm đăng nhập Google → Gateway → auth-service → callback đặt cookie `aesp_token`.
3. Frontend có thể lưu token vào localStorage; các API về sau dùng cookie hoặc bearer.

## Phát triển local (không dùng Docker)

1. Khởi động Postgres (khớp `DATABASE_URL`).
2. Chạy migrations trong `database/init/*.sql` (hoặc để dịch vụ tự tạo bảng tối thiểu nếu thiếu).
3. Cài đặt phụ thuộc cho từng service:
   ```bash
   cd services/learner-service && npm install
   cd ../auth-service && npm install
   cd ../../pronunciation-assessment && npm install
   cd ../../frontend && npm install
   ```
4. Chạy dịch vụ ở các terminal khác nhau:
   ```bash
   node services/auth-service/src/index.js
   node services/learner-service/src/index.js
   node pronunciation-assessment/index.js
   npm --prefix frontend run dev
   node gateway/src/index.js
   ```

## Endpoint quan trọng

| Endpoint                                        | Method | Mô tả                               |
| ----------------------------------------------- | ------ | ----------------------------------- |
| `/api/auth/google`                              | GET    | Bắt đầu Google OAuth                |
| `/api/auth/callback`                            | GET    | OAuth callback, đặt cookie          |
| `/api/auth/me`                                  | GET    | Lấy thông tin người dùng hiện tại   |
| `/api/learners/subscriptions/plans`             | GET    | Danh sách gói                       |
| `/api/learners/subscriptions/choose`            | POST   | Đăng ký gói                         |
| `/api/learners/learning-path/roadmap`           | GET    | Lấy roadmap theo người dùng         |
| `/api/learners/learning-path/lessons/:id/start` | POST   | Bắt đầu phiên hội thoại             |
| `/api/pronunciation/assess`                     | POST   | Upload & chấm phát âm               |
| `/api/pronunciation/tts`                        | POST   | Tổng hợp & cache giọng AI thành MP3 |

## Chiến lược cache

| Lớp          | Kỹ thuật                                         | Lợi ích                 |
| ------------ | ------------------------------------------------ | ----------------------- |
| TTS          | MP3 theo nội dung + khử trùng lặp khi đang synth | Giảm gọi Azure lặp lại  |
| Roadmap      | Advisory lock (pg_advisory_lock)                 | Tránh tạo roadmap trùng |
| AI (dự kiến) | TTL cache trong bộ nhớ cho start/hints           | Giảm chi phí token      |

## Mẫu xử lý bất đồng bộ & độ bền

- `fetchWithRetry` + AbortController để timeout an toàn.
- Giới hạn đồng thời cho OpenAI (learner-service) & Azure TTS.
- Express error middleware toàn cục + log unhandled rejection.
- Rate limiting cho route nhạy cảm (auth) và toàn cục.

## Ghi chú bảo mật

- Không commit API key thật; dùng `.env` và xoay vòng secret ở production.
- Bật HTTPS + `secure: true` cho cookie khi sau TLS.
- Cân nhắc Redis làm store rate limit khi chạy nhiều replica.

## Khắc phục sự cố (Troubleshooting)

| Triệu chứng                  | Nguyên nhân                  | Cách xử lý                                   |
| ---------------------------- | ---------------------------- | -------------------------------------------- |
| TTS trả audio rỗng           | Sai `SPEECH_REGION` hoặc key | Kiểm tra key/region khớp Azure               |
| 429 từ OpenAI                | Đồng thời quá cao            | Hạ `OPENAI_CONCURRENCY` hoặc bật cache       |
| Roadmap báo thiếu level/goal | Chưa onboarding              | Gửi `POST /api/learners/onboarding/complete` |
| Vòng lặp OAuth               | Sai `GOOGLE_CALLBACK_URL`    | Khớp URL & path của Gateway                  |

## Nâng cấp tương lai

- Streaming phản hồi AI (Server‑Sent Events).
- Circuit breaker cho lỗi upstream lặp lại.
- Redis/LRU cache cho gợi ý AI.
- Prometheus metrics & dashboard.

## Giấy phép

Mục đích demo nội bộ; chưa khai báo license. Thêm license nếu phát hành rộng rãi.

---

Nếu có câu hỏi hoặc muốn mở rộng, hãy mở issue hoặc gửi PR.
