# 🧬 PRODUCT REQUIREMENTS DOCUMENT (PRD)

**Project:** AESP – AI English Speaking Platform (v3.0)  
**Author:** Lưu Minh (Student Developer)  
**Date:** 09/10/2025  

---

## 1. OVERVIEW

### 1.1 Product Vision
Build an AI-powered English speaking platform that helps Vietnamese learners practice English confidently through real-time speech recognition, pronunciation feedback, grammar correction, and mentor-guided practice.  
The platform is designed with a **microservice architecture** for scalability and containerized using **Docker** for efficient deployment.

### 1.2 Objectives
- Provide a judgment-free environment for English learners to practice speaking.  
- Integrate AI-driven speech recognition and pronunciation scoring.  
- Deliver grammar and vocabulary correction via OpenAI models.  
- Personalize lessons based on proficiency level and learner performance.  
- Support mentor-led and community-based speaking sessions.

### 1.3 Target Users

| User Type | Description |
|------------|-------------|
| Learners | English learners (beginner → advanced) who want to improve speaking skills. |
| Mentors | Experienced English speakers or teachers who evaluate and coach learners. |
| Admin | Platform operator managing users, mentors, content, and analytics. |

---

## 2. KEY FEATURES & FUNCTIONAL REQUIREMENTS

### 2.1 Learner Module
- Account management (register, login, update profile)  
- AI level test (initial speaking test)  
- Adaptive learning path (AI-suggested topics)  
- AI conversation (speech-to-text + grammar feedback)  
- Vocabulary suggestions and sentence corrections  
- Community voice rooms for group practice  
- Progress analytics dashboard with charts and badges  
- Purchase learning packages (basic, premium)  
- Weekly and monthly reports (auto-generated)

### 2.2 Mentor Module
- Dashboard with assigned learners and reports  
- Audio assessment tools for pronunciation, grammar, and fluency  
- Chat or video session with learners  
- Topic creation by category (business, travel, etc.)  
- Learner evaluation and feedback submission

### 2.3 Admin Module
- User, mentor, and package management  
- System analytics and usage reports  
- Policy management (privacy, terms)  
- Feedback moderation and performance tracking

---

## 3. NON-FUNCTIONAL REQUIREMENTS

| Category | Requirement |
|-----------|-------------|
| Performance | Handle 500+ concurrent learners with sub-2s API response time. |
| Scalability | Microservice architecture using Docker Compose, scalable to Kubernetes. |
| Security | JWT authentication, bcrypt password hashing, HTTPS enforced. |
| Maintainability | Clean Architecture for .NET Core services and unified API structure. |
| Maintainability | Modular, layered architecture for Node.js (TypeScript) services with a unified API structure. |
| Integration | Unified OpenAI API key for Whisper and GPT-4o-mini models. |
| Database | PostgreSQL chosen for JSONB support and strong ACID compliance. |
| Cost | All services use free-tier or open-source tools. |
| Deployment | CI/CD via GitHub Actions, deploy to Vercel (frontend) & Render (backend). |

---

## 4. SYSTEM ARCHITECTURE

### 4.1 Tech Stack

| Layer | Technology | Reason |
|--------|-------------|--------|
| Frontend | React.js + Vite + TailwindCSS + shadcn/ui + Framer Motion + Lottie | Modern, fast, animated UI. |
| Backend Services | Node.js (TypeScript) – NestJS/Express microservices (Auth, Learner, Mentor) | Scalable, maintainable microservices. |
| AI Service | Node.js (OpenAI Whisper + GPT-4o-mini) | Lightweight and asynchronous for AI calls. |
| Database | PostgreSQL (Neon.tech / Supabase / Render) | JSONB for AI feedback and analytics. |
| Containerization | Docker + Docker Compose | Simplified multi-service deployment. |
| Gateway | Nginx / Node gateway (Express/Nest/Fastify) | API routing and load balancing. |
| Storage | Cloudinary | Free-tier audio storage. |
| Version Control | GitHub | Collaboration and versioning. |

### 4.2 Architecture Overview
```
Frontend (React + Vite)
     ↓
API Gateway (Nginx / YARP)
     ↓
 ┌────────────────────────────────────────────────────────────────────────┐
 │ Microservices (Node.js)           │
 │  - Auth Service                   │
 │  - Learner Service                │
 │  - Mentor Service                 │
 └────────────────────────────────────────────────────────────────────────┘
     ↓
AI Service (Node.js)
     ↓
PostgreSQL Database (JSONB feedback)
```

### 4.3 AI Integration Flow (Unified OpenAI)
1. Learner speaks into mic → audio sent to AI Service.  
2. Whisper API (OpenAI) converts speech to text.  
3. GPT-4o-mini analyzes grammar, vocabulary, and pronunciation.  
4. AI Service returns corrected transcript and feedback to frontend.  
5. Learner Service stores the result in PostgreSQL as JSONB.

### 4.4 Database Schema (Simplified – PostgreSQL)
```
users(id, name, email, password, role, level)
packages(id, name, price, duration)
purchases(id, user_id, package_id, date)
sessions(id, user_id, topic, ai_score, grammar_feedback JSONB, created_at)
reports(id, user_id, avg_score, total_sessions, last_active, progress_data JSONB)
feedback(id, user_id, content, date)
community_rooms(id, topic, status, participants)
```
→ Using JSONB for storing AI grammar feedback and analytics logs.

### 4.5 Containerization (Docker Setup)
- Each service runs as an independent Docker container.  
- Managed by `docker-compose.yml` with shared network.  
- Environment variables stored in `.env` file.  

Example snippet:
```yaml
version: '3.9'
services:
  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
  auth-service:
    build: ./services/auth-service
    ports:
      - "5001:80"
  learner-service:
    build: ./services/learner-service
    ports:
      - "5002:80"
  ai-service:
    build: ./services/ai-service
    ports:
      - "5004:5004"
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: aesp
      POSTGRES_PASSWORD: password
      POSTGRES_DB: aespdb
    ports:
      - "5432:5432"
```

---

## 5. API DESIGN (Gateway Level)

| Method | Endpoint | Description |
|---------|-----------|-------------|
| POST | /api/auth/register | Create new user |
| POST | /api/auth/login | Authenticate user |
| GET | /api/learners/:id | Retrieve learner info |
| POST | /api/ai/speech | Send audio for AI feedback |
| POST | /api/ai/grammar | Grammar correction & analysis |
| GET | /api/reports/:id | Get learner progress report |
| POST | /api/community/join | Join voice practice room |
| POST | /api/mentor/feedback | Mentor evaluation submission |

---

## 6. SUCCESS METRICS (KPIs)

| KPI | Target |
|------|--------|
| Average speaking sessions per learner/week | ≥ 3 |
| Returning user rate | ≥ 60% |
| AI response time | < 2 seconds |
| Whisper transcription accuracy | ≥ 90% |
| Grammar feedback accuracy (GPT-4o-mini) | ≥ 85% |

---

## 7. ROADMAP (6-WEEK MVP)

| Week | Goal |
|-------|------|
| 1 | Setup monorepo, Docker Compose, PostgreSQL connection |
| 2 | Develop Auth and Gateway services (Node.js) |
| 3 | Build Learner and Mentor services (Node.js) |
| 4 | Implement AI Service (Node.js Whisper + GPT) |
| 5 | Integrate Frontend with Gateway and API services |
| 6 | Testing, CI/CD setup, and final deployment |

---

## 8. FUTURE UPGRADES
- Flutter Mobile App version  
- Real-time mentor video sessions  
- Gamification system (XP, badges, challenges)  
- AI Vocabulary Builder  
- Integration with Google Meet API for mentor scheduling  

---

## 9. APPENDIX: DEPLOYMENT

| Component | Platform |
|------------|-----------|
| Frontend | Vercel |
| Backend Services | Render / Railway (Docker) |
| Database | PostgreSQL (Neon.tech / Supabase) |
| Storage | Cloudinary |
| AI Integration | OpenAI Whisper + GPT-4o-mini (single API key) |
| Version Control | GitHub + CI/CD via GitHub Actions |

---

### ✅ Summary
This **AESP PRD v3.0** integrates **PostgreSQL**, **Dockerized Node.js Microservices**, **unified OpenAI API for Whisper + GPT-4o-mini**, and a **modern animated frontend stack** (React + Tailwind + shadcn/ui).  
The system is **production-ready**, **scalable**, and aligned with **real-world SaaS architecture standards**.

