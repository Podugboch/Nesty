import React, { useState, useEffect, useCallback } from "react";

interface AdminUser {
  id: number;
  username: string;
  name?: string;
  email: string;
  avatar_url?: string;
  role: "user" | "moderator" | "admin" | "super_admin";
  status: "active" | "suspended" | "banned";
  suspended_until?: string | null;
  status_reason?: string;
  created_at: string;
  last_seen_at?: string;
}

interface AdminReport {
  id: number;
  reporter_id: number;
  reporter?: { id: number; username: string; name?: string };
  target_type: "post" | "comment" | "user";
  target_id: number;
  reason: string;
  note?: string;
  status: "open" | "resolved" | "dismissed";
  resolved_by?: number;
  resolver?: { id: number; username: string };
  resolution?: string;
  created_at: string;
  resolved_at?: string;
  target_content?: string;
  target_author?: string;
  target_author_id?: number;
  target_details?: string;
}

interface AuditLogEntry {
  id: number;
  admin_id: number;
  admin?: { id: number; username: string; email: string };
  action: string;
  target_type: string;
  target_id: number;
  reason: string;
  metadata: string;
  created_at: string;
}

interface StatsData {
  total_users: number;
  new_users_today: number;
  dau: number;
  posts_today: number;
  comments_today: number;
  calls_today: number;
  open_reports: number;
  activity_chart: { date: string; signups: number; posts: number }[];
}

interface AdminViewProps {
  currentUser: {
    id: number;
    username: string;
    role?: string;
  };
  apiUrl: string;
  token: string | null;
  onExitAdmin: () => void;
}

const ROLE_RANKS: Record<string, number> = {
  user: 0,
  moderator: 1,
  admin: 2,
  super_admin: 3,
};

export const AdminView: React.FC<AdminViewProps> = ({
  currentUser,
  apiUrl,
  token,
  onExitAdmin,
}) => {
  const callerRank = ROLE_RANKS[currentUser.role || "user"] || 0;
  const isSuperAdmin = currentUser.role === "super_admin";
  const isAdminOrAbove = callerRank >= 2;

  // Navigation tab
  const [activeTab, setActiveTab] = useState<"dashboard" | "reports" | "users" | "audit">(() => {
    return isAdminOrAbove ? "dashboard" : "reports";
  });

  // Global feedback / toast
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const showFeedback = (type: "success" | "error", text: string) => {
    setFeedback({ type, text });
    setTimeout(() => setFeedback(null), 4000);
  };

  // ---------------------------------------------------------------------------
  // TAB 1: DASHBOARD STATS
  // ---------------------------------------------------------------------------
  const [stats, setStats] = useState<StatsData | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const fetchStats = useCallback(async () => {
    if (!isAdminOrAbove || !token) return;
    setStatsLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/admin/stats`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (err) {
      console.error("fetch stats err", err);
    } finally {
      setStatsLoading(false);
    }
  }, [apiUrl, token, isAdminOrAbove]);

  useEffect(() => {
    if (activeTab === "dashboard") {
      fetchStats();
    }
  }, [activeTab, fetchStats]);

  // ---------------------------------------------------------------------------
  // TAB 2: REPORTS QUEUE
  // ---------------------------------------------------------------------------
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportStatusFilter, setReportStatusFilter] = useState<string>("open");
  const [reportTypeFilter, setReportTypeFilter] = useState<string>("all");
  const [reportsPage, setReportsPage] = useState<number>(1);
  const [totalReports, setTotalReports] = useState<number>(0);

  // Resolution Action Modal
  const [resolveActionModal, setResolveActionModal] = useState<{
    report: AdminReport;
    action: "dismiss" | "remove_content" | "suspend_user" | "ban_user";
  } | null>(null);
  const [resolveNote, setResolveNote] = useState<string>("");
  const [resolveDuration, setResolveDuration] = useState<number>(24);
  const [reenterPassword, setReenterPassword] = useState<string>("");
  const [actionSubmitting, setActionSubmitting] = useState<boolean>(false);

  const fetchReports = useCallback(async () => {
    if (!token) return;
    setReportsLoading(true);
    try {
      const params = new URLSearchParams({
        status: reportStatusFilter,
        type: reportTypeFilter,
        page: reportsPage.toString(),
        limit: "15",
      });
      const res = await fetch(`${apiUrl}/api/admin/reports?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setReports(data.reports || []);
        setTotalReports(data.total || 0);
      }
    } catch (err) {
      console.error("fetch reports err", err);
    } finally {
      setReportsLoading(false);
    }
  }, [apiUrl, token, reportStatusFilter, reportTypeFilter, reportsPage]);

  useEffect(() => {
    if (activeTab === "reports") {
      fetchReports();
    }
  }, [activeTab, fetchReports]);

  const handleExecuteReportResolution = async () => {
    if (!resolveActionModal || !token) return;
    if (resolveActionModal.action === "ban_user" && !reenterPassword) {
      showFeedback("error", "Please re-enter your password to confirm ban");
      return;
    }
    setActionSubmitting(true);
    try {
      const res = await fetch(`${apiUrl}/api/admin/reports/${resolveActionModal.report.id}/resolve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: resolveActionModal.action,
          note: resolveNote,
          duration_hours: resolveDuration,
          confirm_password: reenterPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to resolve report");
      }
      showFeedback("success", `Report resolved with action: ${resolveActionModal.action}`);
      setResolveActionModal(null);
      setResolveNote("");
      setReenterPassword("");
      fetchReports();
    } catch (err: any) {
      showFeedback("error", err.message);
    } finally {
      setActionSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // TAB 3: USERS MANAGEMENT
  // ---------------------------------------------------------------------------
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersSearch, setUsersSearch] = useState<string>("");
  const [userStatusFilter, setUserStatusFilter] = useState<string>("all");
  const [userRoleFilter, setUserRoleFilter] = useState<string>("all");
  const [usersPage, setUsersPage] = useState<number>(1);
  const [totalUsers, setTotalUsers] = useState<number>(0);

  // User details modal
  const [viewedUser, setViewedUser] = useState<any | null>(null);
  const [viewedUserLoading, setViewedUserLoading] = useState(false);

  // User Actions: Suspend, Ban, Restore, Role Change
  const [userActionDialog, setUserActionDialog] = useState<{
    user: AdminUser;
    type: "suspend" | "ban" | "restore" | "role";
  } | null>(null);
  const [dialogReason, setDialogReason] = useState<string>("");
  const [dialogDuration, setDialogDuration] = useState<number>(24);
  const [dialogNewRole, setDialogNewRole] = useState<string>("user");
  const [dialogPassword, setDialogPassword] = useState<string>("");
  const [dialogSubmitting, setDialogSubmitting] = useState<boolean>(false);

  const fetchUsers = useCallback(async () => {
    if (!isAdminOrAbove || !token) return;
    setUsersLoading(true);
    try {
      const params = new URLSearchParams({
        q: usersSearch,
        status: userStatusFilter,
        role: userRoleFilter,
        page: usersPage.toString(),
        limit: "15",
      });
      const res = await fetch(`${apiUrl}/api/admin/users?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
        setTotalUsers(data.total || 0);
      }
    } catch (err) {
      console.error("fetch users err", err);
    } finally {
      setUsersLoading(false);
    }
  }, [apiUrl, token, isAdminOrAbove, usersSearch, userStatusFilter, userRoleFilter, usersPage]);

  useEffect(() => {
    if (activeTab === "users") {
      fetchUsers();
    }
  }, [activeTab, fetchUsers]);

  const fetchUserDetails = async (userId: number) => {
    if (!token) return;
    setViewedUserLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/admin/users/${userId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setViewedUser(data);
      }
    } catch (err) {
      console.error("fetch user details err", err);
    } finally {
      setViewedUserLoading(false);
    }
  };

  const handleExecuteUserAction = async () => {
    if (!userActionDialog || !token) return;
    setDialogSubmitting(true);
    try {
      let endpoint = "";
      let body: any = {};

      const target = userActionDialog.user;
      if (userActionDialog.type === "suspend") {
        endpoint = `${apiUrl}/api/admin/users/${target.id}/suspend`;
        body = { reason: dialogReason, duration_hours: dialogDuration };
      } else if (userActionDialog.type === "ban") {
        if (!dialogPassword) throw new Error("Please re-enter your password to confirm ban");
        endpoint = `${apiUrl}/api/admin/users/${target.id}/ban`;
        body = { reason: dialogReason, confirm_password: dialogPassword };
      } else if (userActionDialog.type === "restore") {
        endpoint = `${apiUrl}/api/admin/users/${target.id}/restore`;
        body = {};
      } else if (userActionDialog.type === "role") {
        if (!dialogPassword) throw new Error("Please re-enter your password to confirm role change");
        endpoint = `${apiUrl}/api/admin/users/${target.id}/role`;
        body = { role: dialogNewRole, confirm_password: dialogPassword };
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Action failed");
      }

      showFeedback("success", `User @${target.username} successfully updated.`);
      setUserActionDialog(null);
      setDialogReason("");
      setDialogPassword("");
      fetchUsers();
      if (viewedUser && viewedUser.user.id === target.id) {
        fetchUserDetails(target.id);
      }
    } catch (err: any) {
      showFeedback("error", err.message);
    } finally {
      setDialogSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // TAB 4: AUDIT LOG (SUPER ADMIN ONLY)
  // ---------------------------------------------------------------------------
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditActionFilter, setAuditActionFilter] = useState<string>("all");
  const [auditPage, setAuditPage] = useState<number>(1);
  const [totalAudit, setTotalAudit] = useState<number>(0);

  const fetchAuditLogs = useCallback(async () => {
    if (!isSuperAdmin || !token) return;
    setAuditLoading(true);
    try {
      const params = new URLSearchParams({
        action: auditActionFilter,
        page: auditPage.toString(),
        limit: "20",
      });
      const res = await fetch(`${apiUrl}/api/admin/audit-log?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAuditLogs(data.logs || []);
        setTotalAudit(data.total || 0);
      }
    } catch (err) {
      console.error("fetch audit logs err", err);
    } finally {
      setAuditLoading(false);
    }
  }, [apiUrl, token, isSuperAdmin, auditActionFilter, auditPage]);

  useEffect(() => {
    if (activeTab === "audit") {
      fetchAuditLogs();
    }
  }, [activeTab, fetchAuditLogs]);

  return (
    <div className="admin-container">
      {/* Top Bar Header */}
      <div className="admin-top-bar">
        <div className="admin-brand-group">
          <span className="admin-badge-role">{currentUser.role?.toUpperCase()}</span>
          <h2 className="admin-title">Nesty Administration</h2>
        </div>
        <button className="admin-exit-btn" onClick={onExitAdmin} title="Return to Home feed">
          ← Exit Admin
        </button>
      </div>

      {/* Global Feedback Banner */}
      {feedback && (
        <div className={`admin-feedback-toast ${feedback.type}`}>
          {feedback.type === "success" ? "✓ " : "⚠️ "} {feedback.text}
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="admin-nav-tabs">
        {isAdminOrAbove && (
          <button
            className={`admin-tab-btn ${activeTab === "dashboard" ? "active" : ""}`}
            onClick={() => setActiveTab("dashboard")}
          >
            📊 Dashboard
          </button>
        )}
        <button
          className={`admin-tab-btn ${activeTab === "reports" ? "active" : ""}`}
          onClick={() => setActiveTab("reports")}
        >
          🚩 Reports Queue {stats?.open_reports ? `(${stats.open_reports})` : ""}
        </button>
        {isAdminOrAbove && (
          <button
            className={`admin-tab-btn ${activeTab === "users" ? "active" : ""}`}
            onClick={() => setActiveTab("users")}
          >
            👥 User Management
          </button>
        )}
        {isSuperAdmin && (
          <button
            className={`admin-tab-btn ${activeTab === "audit" ? "active" : ""}`}
            onClick={() => setActiveTab("audit")}
          >
            🛡️ Audit Log
          </button>
        )}
      </div>

      {/* =================================================================== */}
      {/* 1. DASHBOARD TAB                                                    */}
      {/* =================================================================== */}
      {activeTab === "dashboard" && (
        <div className="admin-dashboard-view">
          {statsLoading ? (
            <div className="admin-loading-spinner">Loading platform statistics...</div>
          ) : stats ? (
            <>
              {/* Stat Cards Grid */}
              <div className="admin-stats-grid">
                <div className="admin-stat-card">
                  <div className="stat-label">Total Users</div>
                  <div className="stat-value">{stats.total_users.toLocaleString()}</div>
                  <div className="stat-sub">Registered accounts</div>
                </div>
                <div className="admin-stat-card">
                  <div className="stat-label">Signups Today</div>
                  <div className="stat-value accent">{stats.new_users_today}</div>
                  <div className="stat-sub">New registrations in 24h</div>
                </div>
                <div className="admin-stat-card">
                  <div className="stat-label">Daily Active Users</div>
                  <div className="stat-value green">{stats.dau}</div>
                  <div className="stat-sub">Users active today</div>
                </div>
                <div className="admin-stat-card">
                  <div className="stat-label">Posts Today</div>
                  <div className="stat-value">{stats.posts_today}</div>
                  <div className="stat-sub">New posts published</div>
                </div>
                <div className="admin-stat-card">
                  <div className="stat-label">Comments Today</div>
                  <div className="stat-value">{stats.comments_today}</div>
                  <div className="stat-sub">Discussions & replies</div>
                </div>
                <div className="admin-stat-card">
                  <div className="stat-label">Calls Today</div>
                  <div className="stat-value">{stats.calls_today}</div>
                  <div className="stat-sub">Audio/video calls initiated</div>
                </div>
                <div className="admin-stat-card danger">
                  <div className="stat-label">Open Reports</div>
                  <div className="stat-value red">{stats.open_reports}</div>
                  <div className="stat-sub">Awaiting moderation</div>
                </div>
              </div>

              {/* 7-Day Activity Trends SVG Chart */}
              <div className="admin-chart-card">
                <h3>7-Day Growth & Activity Trends</h3>
                <p className="chart-subtitle">Signups (blue) vs. New Posts (green) over the last 7 days</p>

                {stats.activity_chart && stats.activity_chart.length > 0 ? (
                  <div className="svg-chart-container">
                    <svg viewBox="0 0 600 200" className="admin-trend-svg">
                      {/* Grid lines */}
                      <line x1="50" y1="20" x2="570" y2="20" stroke="var(--border-color, #333)" strokeDasharray="3 3" />
                      <line x1="50" y1="80" x2="570" y2="80" stroke="var(--border-color, #333)" strokeDasharray="3 3" />
                      <line x1="50" y1="140" x2="570" y2="140" stroke="var(--border-color, #333)" strokeDasharray="3 3" />
                      <line x1="50" y1="170" x2="570" y2="170" stroke="var(--border-color, #555)" />

                      {/* SVG Polyline & Points */}
                      {(() => {
                        const items = stats.activity_chart;
                        const maxVal = Math.max(
                          ...items.map((i) => Math.max(i.signups, i.posts, 5))
                        );
                        const stepX = 500 / Math.max(items.length - 1, 1);

                        const signupsPoints = items
                          .map((item, idx) => {
                            const x = 50 + idx * stepX;
                            const y = 170 - (item.signups / maxVal) * 140;
                            return `${x},${y}`;
                          })
                          .join(" ");

                        const postsPoints = items
                          .map((item, idx) => {
                            const x = 50 + idx * stepX;
                            const y = 170 - (item.posts / maxVal) * 140;
                            return `${x},${y}`;
                          })
                          .join(" ");

                        return (
                          <>
                            {/* Signups Line */}
                            <polyline
                              fill="none"
                              stroke="#3b82f6"
                              strokeWidth="3"
                              points={signupsPoints}
                            />
                            {/* Posts Line */}
                            <polyline
                              fill="none"
                              stroke="#10b981"
                              strokeWidth="3"
                              points={postsPoints}
                            />
                            {/* Dots and Labels */}
                            {items.map((item, idx) => {
                              const x = 50 + idx * stepX;
                              const ySignups = 170 - (item.signups / maxVal) * 140;
                              const yPosts = 170 - (item.posts / maxVal) * 140;
                              return (
                                <g key={item.date}>
                                  <circle cx={x} cy={ySignups} r="4" fill="#3b82f6" />
                                  <circle cx={x} cy={yPosts} r="4" fill="#10b981" />
                                  <text x={x} y="190" textAnchor="middle" fontSize="11" fill="#888">
                                    {item.date.slice(5)}
                                  </text>
                                </g>
                              );
                            })}
                          </>
                        );
                      })()}
                    </svg>
                    <div className="chart-legend">
                      <span className="legend-item"><span className="legend-dot signups"></span> Signups</span>
                      <span className="legend-item"><span className="legend-dot posts"></span> Posts</span>
                    </div>
                  </div>
                ) : (
                  <p className="no-data-hint">No trend data available for this week.</p>
                )}
              </div>
            </>
          ) : (
            <div>Failed to load statistics.</div>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* 2. REPORTS QUEUE TAB                                                */}
      {/* =================================================================== */}
      {activeTab === "reports" && (
        <div className="admin-reports-view">
          {/* Controls Bar */}
          <div className="admin-controls-bar">
            <div className="filter-group">
              <label>Status:</label>
              <select
                value={reportStatusFilter}
                onChange={(e) => {
                  setReportStatusFilter(e.target.value);
                  setReportsPage(1);
                }}
              >
                <option value="open">Open Reports</option>
                <option value="resolved">Resolved</option>
                <option value="dismissed">Dismissed</option>
                <option value="all">All Statuses</option>
              </select>
            </div>

            <div className="filter-group">
              <label>Target:</label>
              <select
                value={reportTypeFilter}
                onChange={(e) => {
                  setReportTypeFilter(e.target.value);
                  setReportsPage(1);
                }}
              >
                <option value="all">All Content</option>
                <option value="post">Posts</option>
                <option value="comment">Comments</option>
                <option value="user">Users</option>
              </select>
            </div>

            <button className="btn-refresh" onClick={fetchReports}>
              ↻ Refresh
            </button>
          </div>

          {reportsLoading ? (
            <div className="admin-loading-spinner">Loading reports queue...</div>
          ) : reports.length === 0 ? (
            <div className="admin-empty-state">
              <span className="empty-icon">🎉</span>
              <h3>No reports found</h3>
              <p>Everything is peaceful. No reports match the current filter.</p>
            </div>
          ) : (
            <div className="admin-reports-grid">
              {reports.map((rep) => (
                <div key={rep.id} className={`report-card status-${rep.status}`}>
                  <div className="report-card-header">
                    <span className={`target-badge ${rep.target_type}`}>
                      {rep.target_type.toUpperCase()} #{rep.target_id}
                    </span>
                    <span className={`status-pill ${rep.status}`}>{rep.status.toUpperCase()}</span>
                  </div>

                  <div className="report-reason-row">
                    <strong>Reason:</strong> <span className="reason-tag">{rep.reason}</span>
                  </div>

                  {rep.note && (
                    <div className="report-note-row">
                      <strong>Reporter Note:</strong>
                      <p className="note-text">{rep.note}</p>
                    </div>
                  )}

                  {/* Target Content Preview */}
                  <div className="report-content-preview-box">
                    <span className="preview-header">
                      Reported Content {rep.target_author ? `by @${rep.target_author}` : ""}:
                    </span>
                    <p className="preview-body">
                      {rep.target_content ? rep.target_content : <em>[Content removed or user profile]</em>}
                    </p>
                    {rep.target_details && (
                      <span className="preview-details">{rep.target_details}</span>
                    )}
                  </div>

                  <div className="report-meta-footer">
                    <span>Reported by: @{rep.reporter?.username || `User #${rep.reporter_id}`}</span>
                    <span>{new Date(rep.created_at).toLocaleString()}</span>
                  </div>

                  {rep.resolution && (
                    <div className="report-resolution-info">
                      Resolved with <strong>{rep.resolution}</strong> by @{rep.resolver?.username || "Admin"}
                    </div>
                  )}

                  {/* Action Buttons for Open Reports */}
                  {rep.status === "open" && (
                    <div className="report-action-buttons">
                      <button
                        className="btn-action dismiss"
                        onClick={() => setResolveActionModal({ report: rep, action: "dismiss" })}
                      >
                        Dismiss
                      </button>
                      {(rep.target_type === "post" || rep.target_type === "comment") && (
                        <button
                          className="btn-action hide"
                          onClick={() => setResolveActionModal({ report: rep, action: "remove_content" })}
                        >
                          Hide Content
                        </button>
                      )}
                      {isAdminOrAbove && (
                        <>
                          <button
                            className="btn-action suspend"
                            onClick={() => setResolveActionModal({ report: rep, action: "suspend_user" })}
                          >
                            Suspend Author
                          </button>
                          <button
                            className="btn-action ban"
                            onClick={() => setResolveActionModal({ report: rep, action: "ban_user" })}
                          >
                            Ban Author
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalReports > 15 && (
            <div className="admin-pagination">
              <button
                disabled={reportsPage <= 1}
                onClick={() => setReportsPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <span>Page {reportsPage} of {Math.ceil(totalReports / 15)}</span>
              <button
                disabled={reportsPage >= Math.ceil(totalReports / 15)}
                onClick={() => setReportsPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* 3. USER MANAGEMENT TAB                                              */}
      {/* =================================================================== */}
      {activeTab === "users" && (
        <div className="admin-users-view">
          {/* Controls Bar */}
          <div className="admin-controls-bar">
            <input
              type="text"
              className="admin-search-input"
              placeholder="Search by username, name, or email..."
              value={usersSearch}
              onChange={(e) => {
                setUsersSearch(e.target.value);
                setUsersPage(1);
              }}
            />

            <div className="filter-group">
              <label>Role:</label>
              <select
                value={userRoleFilter}
                onChange={(e) => {
                  setUserRoleFilter(e.target.value);
                  setUsersPage(1);
                }}
              >
                <option value="all">All Roles</option>
                <option value="user">User</option>
                <option value="moderator">Moderator</option>
                <option value="admin">Admin</option>
                <option value="super_admin">Super Admin</option>
              </select>
            </div>

            <div className="filter-group">
              <label>Status:</label>
              <select
                value={userStatusFilter}
                onChange={(e) => {
                  setUserStatusFilter(e.target.value);
                  setUsersPage(1);
                }}
              >
                <option value="all">All Statuses</option>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
                <option value="banned">Banned</option>
              </select>
            </div>

            <button className="btn-refresh" onClick={fetchUsers}>
              ↻ Refresh
            </button>
          </div>

          {usersLoading ? (
            <div className="admin-loading-spinner">Loading users directory...</div>
          ) : users.length === 0 ? (
            <div className="admin-empty-state">
              <h3>No users found matching query</h3>
            </div>
          ) : (
            <div className="admin-table-wrapper">
              <table className="admin-responsive-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Joined</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const targetRank = ROLE_RANKS[u.role || "user"] || 0;
                    const canAct = callerRank > targetRank; // caller strictly outranks target

                    return (
                      <tr key={u.id} className={`status-row-${u.status}`}>
                        <td data-label="User">
                          <div className="user-cell" onClick={() => fetchUserDetails(u.id)} style={{ cursor: "pointer" }}>
                            <div className="user-avatar-mini">
                              {u.avatar_url ? (
                                <img src={u.avatar_url} alt="" />
                              ) : (
                                (u.username || "?").charAt(0).toUpperCase()
                              )}
                            </div>
                            <div>
                              <strong>@{u.username}</strong>
                              {u.name && <div className="user-realname">{u.name}</div>}
                            </div>
                          </div>
                        </td>
                        <td data-label="Email">{u.email}</td>
                        <td data-label="Role">
                          <span className={`role-badge ${u.role}`}>{u.role}</span>
                        </td>
                        <td data-label="Status">
                          <span className={`status-badge ${u.status}`}>
                            {u.status}
                            {u.status === "suspended" && u.suspended_until && (
                              <div className="sub-badge-date">
                                until {new Date(u.suspended_until).toLocaleDateString()}
                              </div>
                            )}
                          </span>
                        </td>
                        <td data-label="Joined">
                          {new Date(u.created_at).toLocaleDateString()}
                        </td>
                        <td data-label="Actions" className="actions-cell">
                          <button
                            className="btn-table-action"
                            onClick={() => fetchUserDetails(u.id)}
                            title="View activity & profile"
                          >
                            Details
                          </button>

                          {canAct && (
                            <>
                              {u.status === "active" ? (
                                <>
                                  <button
                                    className="btn-table-action suspend"
                                    onClick={() => setUserActionDialog({ user: u, type: "suspend" })}
                                  >
                                    Suspend
                                  </button>
                                  <button
                                    className="btn-table-action ban"
                                    onClick={() => setUserActionDialog({ user: u, type: "ban" })}
                                  >
                                    Ban
                                  </button>
                                </>
                              ) : (
                                <button
                                  className="btn-table-action restore"
                                  onClick={() => setUserActionDialog({ user: u, type: "restore" })}
                                >
                                  Restore
                                </button>
                              )}

                              {isSuperAdmin && u.id !== currentUser.id && (
                                <button
                                  className="btn-table-action role"
                                  onClick={() => setUserActionDialog({ user: u, type: "role" })}
                                >
                                  Role
                                </button>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalUsers > 15 && (
            <div className="admin-pagination">
              <button
                disabled={usersPage <= 1}
                onClick={() => setUsersPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <span>Page {usersPage} of {Math.ceil(totalUsers / 15)}</span>
              <button
                disabled={usersPage >= Math.ceil(totalUsers / 15)}
                onClick={() => setUsersPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* 4. AUDIT LOG TAB (SUPER ADMIN ONLY)                                 */}
      {/* =================================================================== */}
      {activeTab === "audit" && isSuperAdmin && (
        <div className="admin-audit-view">
          <div className="admin-controls-bar">
            <div className="filter-group">
              <label>Action:</label>
              <select
                value={auditActionFilter}
                onChange={(e) => {
                  setAuditActionFilter(e.target.value);
                  setAuditPage(1);
                }}
              >
                <option value="all">All Actions</option>
                <option value="suspend_user">Suspend User</option>
                <option value="ban_user">Ban User</option>
                <option value="restore_user">Restore User</option>
                <option value="change_role">Change Role</option>
                <option value="hide_content">Hide Content</option>
                <option value="restore_content">Restore Content</option>
                <option value="resolve_report">Resolve Report</option>
              </select>
            </div>
            <button className="btn-refresh" onClick={fetchAuditLogs}>
              ↻ Refresh
            </button>
          </div>

          {auditLoading ? (
            <div className="admin-loading-spinner">Loading audit log...</div>
          ) : auditLogs.length === 0 ? (
            <div className="admin-empty-state">
              <h3>No audit entries recorded</h3>
            </div>
          ) : (
            <div className="admin-table-wrapper">
              <table className="admin-responsive-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Admin</th>
                    <th>Action</th>
                    <th>Target</th>
                    <th>Reason / Details</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map((log) => (
                    <tr key={log.id}>
                      <td data-label="Timestamp">{new Date(log.created_at).toLocaleString()}</td>
                      <td data-label="Admin">
                        <strong>@{log.admin?.username || `Admin #${log.admin_id}`}</strong>
                      </td>
                      <td data-label="Action">
                        <span className={`audit-badge ${log.action}`}>{log.action}</span>
                      </td>
                      <td data-label="Target">
                        {log.target_type} #{log.target_id}
                      </td>
                      <td data-label="Reason">
                        {log.reason && <div><em>Reason:</em> {log.reason}</div>}
                        {log.metadata && log.metadata !== "{}" && (
                          <div className="audit-meta-snippet">{log.metadata}</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalAudit > 20 && (
            <div className="admin-pagination">
              <button
                disabled={auditPage <= 1}
                onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <span>Page {auditPage} of {Math.ceil(totalAudit / 20)}</span>
              <button
                disabled={auditPage >= Math.ceil(totalAudit / 20)}
                onClick={() => setAuditPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* DIALOG: USER DETAILS & ACTIVITY                                     */}
      {/* =================================================================== */}
      {viewedUser && (
        <div className="admin-modal-backdrop" onClick={() => setViewedUser(null)}>
          <div className="admin-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-header">
              <h3>User Profile: @{viewedUser.user?.username}</h3>
              <button className="modal-close-btn" onClick={() => setViewedUser(null)}>✕</button>
            </div>

            {viewedUserLoading ? (
              <div className="admin-loading-spinner" style={{ padding: "36px 0", textAlign: "center" }}>
                Loading user profile details...
              </div>
            ) : (
              <>
                <div className="user-details-summary">
                  <div className="details-stat-pill">
                    <strong>{viewedUser.post_count || 0}</strong> Posts
                  </div>
                  <div className="details-stat-pill">
                    <strong>{viewedUser.comment_count || 0}</strong> Comments
                  </div>
                  <div className="details-stat-pill danger">
                    <strong>{viewedUser.report_count || 0}</strong> Reports Received
                  </div>
                </div>

                <div className="user-profile-meta">
                  <p><strong>Email:</strong> {viewedUser.user?.email}</p>
                  <p><strong>Role:</strong> {viewedUser.user?.role}</p>
                  <p><strong>Status:</strong> {viewedUser.user?.status}</p>
                  {viewedUser.user?.status_reason && (
                    <p><strong>Status Reason:</strong> {viewedUser.user.status_reason}</p>
                  )}
                  {viewedUser.user?.suspended_until && (
                    <p><strong>Suspended Until:</strong> {new Date(viewedUser.user.suspended_until).toLocaleString()}</p>
                  )}
                </div>

                {viewedUser.recent_posts && viewedUser.recent_posts.length > 0 && (
                  <div className="recent-posts-list">
                    <h4>Recent Posts ({viewedUser.recent_posts.length})</h4>
                    {viewedUser.recent_posts.map((p: any) => (
                      <div key={p.id} className="recent-post-item">
                        <span className="post-date">{new Date(p.created_at).toLocaleDateString()}</span>
                        <p className="post-snippet">{p.content || "[Media]"}</p>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            <div className="admin-modal-actions">
              <button className="btn-secondary" onClick={() => setViewedUser(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* DIALOG: RESOLVE REPORT ACTION                                       */}
      {/* =================================================================== */}
      {resolveActionModal && (
        <div className="admin-modal-backdrop" onClick={() => setResolveActionModal(null)}>
          <div className="admin-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-header">
              <h3>Confirm Action: {resolveActionModal.action.replace("_", " ").toUpperCase()}</h3>
              <button className="modal-close-btn" onClick={() => setResolveActionModal(null)}>✕</button>
            </div>

            <p className="confirm-desc">
              Resolving report #{resolveActionModal.report.id} on {resolveActionModal.report.target_type} #{resolveActionModal.report.target_id}.
            </p>

            {resolveActionModal.action === "suspend_user" && (
              <div className="form-group">
                <label className="form-group-label">Suspension Duration (Hours):</label>
                <input
                  type="number"
                  className="admin-input"
                  min="1"
                  max="720"
                  value={resolveDuration}
                  onChange={(e) => setResolveDuration(parseInt(e.target.value) || 24)}
                />
              </div>
            )}

            {resolveActionModal.action === "ban_user" && (
              <div className="form-group">
                <label className="form-group-label">Re-enter Admin Password to Confirm Ban:</label>
                <input
                  type="password"
                  className="admin-input"
                  placeholder="Your admin password"
                  value={reenterPassword}
                  onChange={(e) => setReenterPassword(e.target.value)}
                />
              </div>
            )}

            <div className="form-group">
              <label className="form-group-label">Resolution Note / Reason:</label>
              <textarea
                className="admin-textarea"
                rows={3}
                placeholder="Explain the reason for this moderation resolution..."
                value={resolveNote}
                onChange={(e) => setResolveNote(e.target.value)}
              />
            </div>

            <div className="admin-modal-actions">
              <button
                className="btn-secondary"
                disabled={actionSubmitting}
                onClick={() => setResolveActionModal(null)}
              >
                Cancel
              </button>
              <button
                className="btn-danger"
                disabled={actionSubmitting}
                onClick={handleExecuteReportResolution}
              >
                {actionSubmitting ? "Executing..." : "Confirm Action"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* DIALOG: USER ACTIONS (SUSPEND, BAN, RESTORE, ROLE)                  */}
      {/* =================================================================== */}
      {userActionDialog && (
        <div className="admin-modal-backdrop" onClick={() => setUserActionDialog(null)}>
          <div className="admin-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-header">
              <h3>
                {userActionDialog.type === "suspend" && `Suspend @${userActionDialog.user.username}`}
                {userActionDialog.type === "ban" && `Permanently Ban @${userActionDialog.user.username}`}
                {userActionDialog.type === "restore" && `Restore @${userActionDialog.user.username}`}
                {userActionDialog.type === "role" && `Change Role for @${userActionDialog.user.username}`}
              </h3>
              <button className="modal-close-btn" onClick={() => setUserActionDialog(null)}>✕</button>
            </div>

            {userActionDialog.type === "suspend" && (
              <>
                <div className="form-group">
                  <label className="form-group-label">Duration (Hours):</label>
                  <input
                    type="number"
                    className="admin-input"
                    min="1"
                    max="720"
                    value={dialogDuration}
                    onChange={(e) => setDialogDuration(parseInt(e.target.value) || 24)}
                  />
                  <small className="input-hint">24 hours = 1 day, 168 hours = 1 week</small>
                </div>
                <div className="form-group">
                  <label className="form-group-label">Reason for Suspension (required):</label>
                  <textarea
                    className="admin-textarea"
                    rows={3}
                    placeholder="Enter reason for suspension..."
                    value={dialogReason}
                    onChange={(e) => setDialogReason(e.target.value)}
                  />
                </div>
              </>
            )}

            {userActionDialog.type === "ban" && (
              <>
                <div className="warning-callout">
                  ⚠️ <strong>Destructive Action:</strong> Banning will permanently block this user from logging in or accessing Nesty.
                </div>
                <div className="form-group">
                  <label className="form-group-label">Reason for Ban (required):</label>
                  <textarea
                    className="admin-textarea"
                    rows={3}
                    placeholder="Enter reason for permanent ban..."
                    value={dialogReason}
                    onChange={(e) => setDialogReason(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-group-label">Re-enter Your Admin Password to Confirm:</label>
                  <input
                    type="password"
                    className="admin-input"
                    placeholder="Your password"
                    value={dialogPassword}
                    onChange={(e) => setDialogPassword(e.target.value)}
                  />
                </div>
              </>
            )}

            {userActionDialog.type === "restore" && (
              <p className="confirm-desc">
                This will lift any active suspension or ban on @{userActionDialog.user.username} and return their account to active status.
              </p>
            )}

            {userActionDialog.type === "role" && (
              <>
                <div className="form-group">
                  <label className="form-group-label">Select New Role:</label>
                  <select
                    className="admin-select"
                    value={dialogNewRole}
                    onChange={(e) => setDialogNewRole(e.target.value)}
                  >
                    <option value="user">User (Standard)</option>
                    <option value="moderator">Moderator (Reports & Content)</option>
                    <option value="admin">Administrator (Users, Bans, Stats)</option>
                    <option value="super_admin">Super Administrator (Full Access)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-group-label">Re-enter Your Admin Password to Confirm:</label>
                  <input
                    type="password"
                    className="admin-input"
                    placeholder="Your password"
                    value={dialogPassword}
                    onChange={(e) => setDialogPassword(e.target.value)}
                  />
                </div>
              </>
            )}

            <div className="admin-modal-actions">
              <button
                className="btn-secondary"
                disabled={dialogSubmitting}
                onClick={() => setUserActionDialog(null)}
              >
                Cancel
              </button>
              <button
                className={userActionDialog.type === "ban" ? "btn-danger" : "btn-primary"}
                disabled={dialogSubmitting}
                onClick={handleExecuteUserAction}
              >
                {dialogSubmitting ? "Processing..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
