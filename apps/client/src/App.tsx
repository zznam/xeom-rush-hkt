import React, {useState} from "react";
import {GameCanvas} from "./components/GameCanvas";

const defaultServerUrl = import.meta.env.VITE_WS_URL || "ws://localhost:3002";

export const App: React.FC = () => {
  const [username, setUsername] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);

  const [serverUrl, setServerUrl] = useState(defaultServerUrl);

  const handleStartGame = (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim()) {
      setIsPlaying(true);
    }
  };

  const handleDisconnect = () => {
    setIsPlaying(false);
  };

  if (isPlaying) {
    return (
      <GameCanvas
        username={username.trim()}
        serverUrl={serverUrl.trim()}
        onDisconnect={handleDisconnect}
      />
    );
  }

  return (
    <div className="login-screen">
      <div className="glass-panel login-card">
        <div className="brand-logo">
          <span className="logo-emoji">🛵</span>
          <h1 className="logo-title font-extrabold gradient-text">
            XE ÔM RUSH
          </h1>
          <p className="logo-subtitle">Real-time Autoritative Alley io Game</p>
        </div>

        <form onSubmit={handleStartGame} className="login-form">
          <div className="form-group">
            <label className="form-label" htmlFor="username">
              TÊN TÀI XẾ (USERNAME)
            </label>
            <input
              id="username"
              type="text"
              required
              maxLength={15}
              placeholder="Nhập tên tài xế ví dụ: AnhXeOm..."
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="form-input"
            />
          </div>

          <div className="form-group" style={{marginTop: 12}}>
            <label className="form-label" htmlFor="serverUrl">
              ĐỊA CHỈ SERVER (WEBSOCKET)
            </label>
            <input
              id="serverUrl"
              type="text"
              required
              placeholder={defaultServerUrl}
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              className="form-input"
            />
          </div>

          <button type="submit" className="btn-primary login-btn">
            🛵 LÊN XE & ĐUA NGAY!
          </button>
        </form>

        <div className="rules-section">
          <h4>💡 HƯỚNG DẪN TRÒ CHƠI</h4>
          <ul>
            <li>
              Lái xe ôm đón khách (chấm tròn xanh 🟢) trên đường hoặc tại{" "}
              <strong>Chợ Bến Thành</strong>.
            </li>
            <li>
              Theo dõi vạch chỉ dẫn màu đỏ để đưa khách đến đích (chấm đỏ 🔴).
            </li>
            <li>
              Nhận tiền thưởng <strong>VNĐ</strong> để thăng cấp trên bảng xếp
              hạng tài xế!
            </li>
          </ul>
        </div>
      </div>

      <style>{`
        .login-screen {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100vw;
          height: 100vh;
          background: radial-gradient(circle at center, #1e293b 0%, #0f172a 100%);
          padding: 20px;
        }

        .login-card {
          width: 100%;
          max-width: 440px;
          padding: 32px;
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .brand-logo {
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }

        .logo-emoji {
          font-size: 48px;
          animation: float 3s ease-in-out infinite;
        }

        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }

        .logo-title {
          font-family: 'Outfit', sans-serif;
          font-size: 32px;
          letter-spacing: -0.02em;
        }

        .logo-subtitle {
          font-size: 12px;
          font-weight: 700;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.1em;
        }

        .login-form {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .form-label {
          font-size: 10px;
          font-weight: 800;
          color: #94a3b8;
          letter-spacing: 0.05em;
        }

        .form-input {
          background: rgba(15, 23, 42, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 10px;
          padding: 12px 16px;
          font-size: 14px;
          font-family: inherit;
          color: white;
          outline: none;
          transition: border-color 0.2s, box-shadow 0.2s;
        }

        .form-input:focus {
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.25);
        }

        .login-btn {
          width: 100%;
          margin-top: 8px;
          font-size: 15px;
          padding: 14px;
        }

        .rules-section {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 12px;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .rules-section h4 {
          font-size: 11px;
          font-weight: 800;
          color: #94a3b8;
          letter-spacing: 0.05em;
        }

        .rules-section ul {
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .rules-section li {
          font-size: 11.5px;
          color: #cbd5e1;
          line-height: 1.4;
          padding-left: 12px;
          position: relative;
        }

        .rules-section li::before {
          content: "•";
          color: #3b82f6;
          position: absolute;
          left: 0;
          font-weight: bold;
        }
      `}</style>
    </div>
  );
};

export default App;
