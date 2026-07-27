'use client';

import { useEffect, useState } from 'react';
import { useIsMobile } from '@/hooks/useMediaQuery';
import ErrorBoundary from '../../components/ErrorBoundary';
import LoadingSkeleton from '../../components/LoadingSkeleton';

export default function DashboardPage() {
  const isMobile = useIsMobile();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Simulate async data fetch; replace with real API call when available
    const t = setTimeout(() => setIsLoading(false), 0);
    return () => clearTimeout(t);
  }, []);

  const stats = [
    { label: 'Total Credits', value: '1,250 tons' },
    { label: 'Portfolio Value', value: '$31,250' },
    { label: 'Carbon Offset', value: '1,250 tons' },
    { label: 'Active Projects', value: '5' },
  ];

  const activities = [
    { date: '2024-01-15', action: 'Purchased 100 tons', status: 'Completed' },
    { date: '2024-01-10', action: 'Retired 50 tons', status: 'Verified' },
    { date: '2024-01-05', action: 'Listed for sale', status: 'Active' },
  ];

  const hasData = stats.length > 0 || activities.length > 0;

  return (
    <ErrorBoundary>
    <div className="container" style={{ padding: isMobile ? '16px' : '24px' }}>
      <h1 style={{ fontSize: isMobile ? '24px' : '32px', marginBottom: '24px' }}>
        Dashboard
      </h1>

      {isLoading ? (
        <>
          <div className="dashboard-grid" style={{ marginBottom: '32px' }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="card" style={{ height: '96px' }}>
                <LoadingSkeleton variant="PoolStats" />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} style={{ height: '48px', borderRadius: '8px', background: '#f3f4f6', animation: 'cl-pulse 1.5s ease-in-out infinite' }} />
            ))}
          </div>
        </>
      ) : hasData ? (
        <>
          {/* Stats Grid */}
          <div className="dashboard-grid" style={{ marginBottom: '32px' }}>
            {stats.map((stat, idx) => (
              <div key={idx} className="card">
                <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '8px' }}>
                  {stat.label}
                </div>
                <div style={{ fontSize: isMobile ? '24px' : '28px', fontWeight: 'bold', color: '#1f2937' }}>
                  {stat.value}
                </div>
              </div>
            ))}
          </div>

          {/* Recent Activity */}
          <h2 style={{ fontSize: '20px', marginBottom: '16px' }}>Recent Activity</h2>
          
          {isMobile ? (
            <div className="mobile-card-container">
              {activities.map((activity, idx) => (
                <div key={idx} className="mobile-card">
                  <div className="mobile-card-title">{activity.date}</div>
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">Action</span>
                    <span className="mobile-card-value">{activity.action}</span>
                  </div>
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">Status</span>
                    <span className="mobile-card-value" style={{ color: '#10b981' }}>
                      {activity.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Action</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {activities.map((activity, idx) => (
                    <tr key={idx}>
                      <td>{activity.date}</td>
                      <td>{activity.action}</td>
                      <td style={{ color: '#10b981' }}>{activity.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <div style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center', 
          justifyContent: 'center', 
          padding: '64px 24px', 
          background: 'var(--bg-secondary, #f9fafb)', 
          borderRadius: '12px',
          textAlign: 'center',
          marginTop: '32px'
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🌱</div>
          <h2 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '8px', color: 'var(--text-primary)' }}>
            Welcome to Carbon Ledger
          </h2>
          <p style={{ fontSize: '16px', color: '#6b7280', maxWidth: '400px', marginBottom: '24px' }}>
            Your dashboard is empty right now. Once you purchase or retire carbon credits, your portfolio stats and recent activities will appear here.
          </p>
          <a 
            href="/marketplace" 
            style={{ 
              padding: '12px 24px', 
              background: '#4CAF50', 
              color: 'white', 
              textDecoration: 'none', 
              borderRadius: '8px',
              fontWeight: 'bold',
              display: 'inline-block'
            }}
          >
            Browse Marketplace
          </a>
        </div>
      )}
    </div>
    </ErrorBoundary>
  );
}
