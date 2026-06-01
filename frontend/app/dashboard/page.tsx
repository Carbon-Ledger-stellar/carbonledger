'use client';

import { useIsMobile } from '@/hooks/useMediaQuery';
import ErrorBoundary from '../../components/ErrorBoundary';

export default function DashboardPage() {
  const isMobile = useIsMobile();

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

  return (
    <ErrorBoundary>
    <div className="container" style={{ padding: isMobile ? '16px' : '24px' }}>
      <h1 style={{ fontSize: isMobile ? '24px' : '32px', marginBottom: '24px' }}>
        Dashboard
      </h1>

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
    </div>
    </ErrorBoundary>
  );
}
