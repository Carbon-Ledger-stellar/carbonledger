import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';

const STATUS_PAGE_URL = 'https://status.example.com';

interface PauseStatus {
  paused: boolean;
  reason?: string;
}

function PauseBanner() {
  const [status, setStatus] = useState<PauseStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      try {
        const res = await fetch('/api/status');
        if (!res.ok) return;
        const data = (await res.json()) as PauseStatus;
        if (!cancelled) setStatus(data);
      } catch {
        // Status endpoint unavailable; no banner to show.
      }
    }

    loadStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status || !status.paused || dismissed) return null;

  return (
    <div
      role="alert"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1rem',
        padding: '0.75rem 1rem',
        backgroundColor: '#c0392b',
        color: '#ffffff',
        textAlign: 'center',
      }}
    >
      <span>
        Contract is paused. Operations are currently blocked.
        {status.reason ? ` Reason: ${status.reason}` : ''}
      </span>
      <a
        href={STATUS_PAGE_URL}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: '#ffffff', textDecoration: 'underline', fontWeight: 600 }}
      >
        Learn More
      </a>
      <button
        type="button"
        aria-label="Dismiss pause banner"
        onClick={() => setDismissed(true)}
        style={{
          background: 'transparent',
          border: '1px solid #ffffff',
          borderRadius: '4px',
          color: '#ffffff',
          cursor: 'pointer',
          padding: '0.25rem 0.5rem',
        }}
      >
        Dismiss
      </button>
    </div>
  );
}

function Home() {
  return <h1>Home</h1>;
}

function App() {
  return (
    <Router>
      <PauseBanner />
      <nav>
        <Link to="/">Home</Link>
      </nav>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
    </Router>
  );
}

export default App;
