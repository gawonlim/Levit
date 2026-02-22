# 퍼블릭 호스팅 가이드

프론트(React/Vite) + 백엔드(Node/Express, FAISS·CSV·OpenAI) 배포 방법 요약입니다.

---

## 1. 구성 선택

| 방식 | 설명 |
|------|------|
| **A. 한 서버에 통합** | Express가 `frontend/dist` 정적 파일 서빙 + `/api` 처리. 백엔드만 한 곳에 배포. |
| **B. 프론트/백 분리** | 프론트는 Vercel/Netlify, 백엔드는 Railway/Render 등. 두 URL 사용. |

FAISS 등 네이티브 의존성이 있어서 **백엔드는 Node 서버가 돌아가는 플랫폼**이 필요합니다.

---

## 2. A안: 한 서버에 통합 (구현됨)

같은 도메인에서 프론트·API 둘 다 제공. **server.js에 정적 서빙 코드가 이미 들어가 있습니다.**

### 2.1 로컬에서 A안 확인 (배포 전 체크)

**1) 프론트 빌드**

```bash
cd frontend
npm run build
```

→ `frontend/dist` 폴더가 생기면 성공.

**2) 백엔드만 켜기 (같은 포트에서 프론트+API)**

```bash
cd backend
node server.js
```

(또는 프로젝트 루트에서: `cd backend && node server.js`)

**3) 브라우저에서 확인**

- 주소: **http://localhost:3001**
- 이 한 주소로 React 첫 화면 + Get Consensus 후 결과까지 모두 동작해야 함.
- 개발할 때처럼 프론트(5173)와 백(3001)을 따로 띄우지 않아도 됨.

**4) 문제 있을 때**

- `frontend/dist`가 없다고 나오면: 1단계 `npm run build`를 다시 실행.
- `data/final_data.csv` 없다고 나오면: 프로젝트 루트에 `data/` 폴더와 CSV가 있는지 확인.

### 2.2 동작

- 서버 기동 시 `frontend/dist`가 있으면 `express.static`으로 서빙하고, `/api`가 아닌 GET 요청은 `index.html`로 넘깁니다 (SPA 대응).
- API는 기존처럼 `/api/health`, `/api/products`, `/api/consensus-and-recommendations`에서 처리됩니다.
- 배포 시 **프로젝트 루트**에 `backend/`, `frontend/dist`, `data/`가 함께 있어야 합니다.

### 2.3 배포 순서 (예: Render)

1. **프론트 빌드**: `cd frontend && npm run build` → `frontend/dist` 생성.
2. **저장소**에 `backend/`, `frontend/dist/`, `data/final_data.csv` 포함 (또는 빌드 스텝에서 `npm run build` 실행).
3. **호스팅**에서 루트를 **프로젝트 루트**로 두고, 시작 명령을 `cd backend && node server.js` (또는 `npm run start`)로 설정.
4. **환경 변수**: `OPENAI_API_KEY` 설정. 포트는 `process.env.PORT` 사용 (서버가 이미 반영함).

**Railway / Fly.io** 등도 동일: 프로젝트 루트 기준, 빌드로 `frontend/dist` 채우고, 시작은 `backend`에서.

---

## 2.4 Render 쓰는 방법 (단계별)

### 준비

1. **GitHub**에 프로젝트 올리기 (레포 루트에 `backend/`, `frontend/`, `data/` 가 있어야 함).
2. **data/final_data.csv** 가 레포에 포함돼 있는지 확인 (서버가 이 경로에서 CSV를 읽음).
3. **Render** 계정 만들기: https://render.com → Sign Up (GitHub로 로그인 가능).

### 서비스 만들기

1. **Dashboard** → **New +** → **Web Service**.
2. **Connect a repository**에서 GitHub 레포 선택 (Levit 레포 연결).
3. 아래처럼 설정한 뒤 **Create Web Service** 누르기.

| 항목 | 값 |
|------|-----|
| **Name** | 원하는 이름 (예: `levit`) |
| **Region** | Singapore 또는 가까운 지역 |
| **Root Directory** | 비워 두기 (레포 루트 = 프로젝트 루트) |
| **Runtime** | Node |
| **Build Command** | `cd frontend && npm install && npm run build && cd ../backend && npm install` |
| **Start Command** | `cd backend && node server.js` |

4. **Environment** 탭으로 가서 **Add Environment Variable**:
   - **Key**: `OPENAI_API_KEY`
   - **Value**: 본인 OpenAI API 키 (붙여넣기)  
   → **Save Changes**.

5. 첫 배포가 자동으로 돌아감. **Logs** 탭에서 빌드·시작 로그 확인.
6. 끝나면 상단에 **Your service is live at https://levit-xxxx.onrender.com** 처럼 URL이 뜸. 이 주소로 접속하면 퍼블릭에서 앱을 볼 수 있음.

### 참고

- **무료 플랜**이면 한동안 요청 없으면 슬립했다가 첫 요청 시 깨우는 데 30초~1분 걸릴 수 있음.
- `frontend/dist` 는 빌드 시 생성되므로 **반드시 Build Command**에서 `npm run build` 가 실행되게 두기.
- 에러 나면 **Logs** 에서 `Products ready: 74` 같은 메시지가 보이는지, `OPENAI_API_KEY` 가 설정됐는지 확인.

---

## 3. B안: 프론트 / 백엔드 분리

### 3.1 백엔드 (Node)

- **Render** 또는 **Railway**에 `backend` 폴더만 배포.
- 루트 디렉터리를 `backend`로, 시작 스크립트 `npm run start`.
- 환경 변수: `OPENAI_API_KEY`.
- CORS: 배포한 프론트 URL(예: `https://your-app.vercel.app`)을 허용하도록 `server.js`의 `cors()` 설정 확인 또는 `origin` 제한.

### 3.2 프론트엔드 (React)

- **Vercel** 또는 **Netlify**에 `frontend` 폴더 배포 (빌드: `npm run build`, 출력: `dist`).
- **환경 변수**: 백엔드 URL을 넣기 (예: `VITE_API_URL=https://your-backend.onrender.com`).
- 프론트 코드에서 `API_BASE`를 이 env로 설정:

```js
const API_BASE = import.meta.env.VITE_API_URL || '';
```

그리고 `fetch(\`${API_BASE}/api/consensus-and-recommendations`, ...)` 처럼 사용.  
배포 후 Vercel/Netlify에서 `VITE_API_URL` 값을 설정하면 됩니다.

---

## 4. 체크리스트

- [ ] `OPENAI_API_KEY`를 호스팅 쪽 환경 변수로 설정 (백엔드)
- [ ] `data/final_data.csv`가 배포 이미지/파일에 포함되는지 확인 (백엔드 루트 기준 경로)
- [ ] B안이면 CORS에 프론트 URL 추가, 프론트에 `VITE_API_URL` 설정
- [ ] A안이면 Express에서 `express.static('dist')` 등으로 `frontend/dist` 서빙

원하시면 A안 기준으로 **server.js에 정적 서빙 코드**와 **Render/Railway용 설정 예시**를 구체적으로 적어 드리겠습니다.
