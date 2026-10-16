import React, { useState } from "react";

export type ReportTargetType = "post" | "comment" | "user";

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetType: ReportTargetType;
  targetId: number;
  targetPreview?: string;
  apiUrl: string;
  token: string | null;
  onReportSubmitted?: () => void;
}

const REPORT_REASONS: { id: string; label: string; desc: string }[] = [
  { id: "spam", label: "Spam", desc: "Commercial spam, phishing, bot activity, or unsolicited promotions" },
  { id: "harassment", label: "Harassment or Bullying", desc: "Targeted insults, intimidation, threats, or personal attacks" },
  { id: "hate", label: "Hate Speech", desc: "Attacking protected characteristics or discriminatory slurs" },
  { id: "nudity", label: "Nudity or Sexual Content", desc: "Sexually explicit media, pornography, or non-consensual content" },
  { id: "violence", label: "Violence or Dangerous Content", desc: "Depictions of severe violence, self-harm, or illegal acts" },
  { id: "scam", label: "Scam or Fraud", desc: "Financial deception, impersonation, or deceptive schemes" },
  { id: "other", label: "Other Rule Violation", desc: "Other issues breaking community guidelines" },
];

export const ReportModal: React.FC<ReportModalProps> = ({
  isOpen,
  onClose,
  targetType,
  targetId,
  targetPreview,
  apiUrl,
  token,
  onReportSubmitted,
}) => {
  const [selectedReason, setSelectedReason] = useState<string>("spam");
  const [note, setNote] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      setErrorMessage("Please sign in to submit a report.");
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await fetch(`${apiUrl}/api/reports`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          target_type: targetType,
          target_id: targetId,
          reason: selectedReason,
          note: note.trim(),
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 409) {
          throw new Error("You already have an open report for this item. Our moderation team is reviewing it.");
        } else if (res.status === 429) {
          throw new Error("You are submitting reports too quickly. Please wait a minute and try again.");
        } else {
          throw new Error(data.error || "Failed to submit report. Please try again.");
        }
      }

      setSuccessMessage("Thank you. Your report has been submitted to moderators for review.");
      setTimeout(() => {
        onReportSubmitted?.();
        onClose();
        setSuccessMessage(null);
        setNote("");
        setSelectedReason("spam");
      }, 1500);
    } catch (err: any) {
      setErrorMessage(err.message || "An unexpected error occurred.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="report-modal-backdrop" onClick={onClose}>
      <div className="report-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="report-modal-header">
          <div className="report-modal-title-group">
            <span className="report-icon">🚩</span>
            <h3>Report {targetType === "post" ? "Post" : targetType === "comment" ? "Comment" : "User"}</h3>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close modal">
            ✕
          </button>
        </div>

        {targetPreview && (
          <div className="report-target-preview">
            <span className="preview-label">Reporting:</span>
            <p className="preview-text">
              {targetPreview.length > 180 ? `${targetPreview.slice(0, 180)}...` : targetPreview}
            </p>
          </div>
        )}

        {errorMessage && <div className="report-alert error">{errorMessage}</div>}
        {successMessage && <div className="report-alert success">{successMessage}</div>}

        {!successMessage && (
          <form onSubmit={handleSubmit} className="report-form">
            <label className="form-group-label">Why are you reporting this?</label>
            <div className="report-reasons-list">
              {REPORT_REASONS.map((r) => (
                <label
                  key={r.id}
                  className={`report-reason-item ${selectedReason === r.id ? "selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="report_reason"
                    value={r.id}
                    checked={selectedReason === r.id}
                    onChange={() => setSelectedReason(r.id)}
                  />
                  <div className="reason-text-group">
                    <span className="reason-label">{r.label}</span>
                    <span className="reason-desc">{r.desc}</span>
                  </div>
                </label>
              ))}
            </div>

            <div className="form-group" style={{ marginTop: "1rem" }}>
              <label htmlFor="report-note" className="form-group-label">
                Additional Details (Optional)
              </label>
              <textarea
                id="report-note"
                className="report-textarea"
                rows={3}
                placeholder="Explain why this content violates community rules..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
              />
              <span className="char-count">{note.length}/500</span>
            </div>

            <div className="report-modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={onClose}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-danger"
                disabled={submitting}
              >
                {submitting ? "Submitting..." : "Submit Report"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
