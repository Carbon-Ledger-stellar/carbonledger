"use client";

import { Component, ReactNode } from "react";
import { colors } from "../styles/design-system";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("ErrorBoundary caught:", error, info);
    import("../lib/logger").then(({ clientLogger }) => {
      clientLogger.error(error.message, {
        stack: error.stack,
        component_stack: info.componentStack,
      });
    });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div style={{
          background: "#fee2e2",
          border: "1px solid #fca5a5",
          borderRadius: "0.75rem",
          padding: "2rem",
          textAlign: "center",
        }}>
          <p style={{ fontSize: "2rem", margin: "0 0 0.75rem" }}>⚠️</p>
          <h3 style={{ fontWeight: 700, color: "#991b1b", margin: "0 0 0.5rem" }}>
            Something went wrong
          </h3>
          <p style={{ fontSize: "0.875rem", color: "#7f1d1d", margin: "0 0 1.25rem" }}>
            {this.state.error?.message ?? "An unexpected error occurred."}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              background: "#dc2626",
              color: "#fff",
              border: "none",
              borderRadius: "0.5rem",
              padding: "0.6rem 1.5rem",
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
