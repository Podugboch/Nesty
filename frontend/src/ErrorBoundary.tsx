import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an unhandled error:", error, errorInfo);
  }

  handleReset = () => {
    localStorage.removeItem("token");
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "#071913",
            color: "#fff",
            padding: "24px",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <div
            style={{
              maxWidth: "480px",
              width: "100%",
              background: "#0c251d",
              padding: "32px",
              borderRadius: "16px",
              border: "1px solid #13382c",
              textAlign: "center",
            }}
          >
            <h2 style={{ margin: "0 0 12px 0", color: "#f87171" }}>Something went wrong</h2>
            <p style={{ color: "#84a999", fontSize: "14px", marginBottom: "20px" }}>
              {this.state.error?.message || "An unexpected error occurred while rendering the interface."}
            </p>
            <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
              <button
                onClick={() => window.location.reload()}
                style={{
                  padding: "10px 18px",
                  background: "#10b981",
                  border: "none",
                  borderRadius: "8px",
                  color: "#fff",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Reload Page
              </button>
              <button
                onClick={this.handleReset}
                style={{
                  padding: "10px 18px",
                  background: "transparent",
                  border: "1px solid #13382c",
                  borderRadius: "8px",
                  color: "#e2ece7",
                  cursor: "pointer",
                }}
              >
                Reset Session & Login
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
